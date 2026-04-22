import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      console.warn('[api/sessions] POST — no user from getUser()')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { type, scenario, score, duration, transcript, feedback } = body

    // Clamp score a [0, 100] para que nunca viole el CHECK de la tabla
    let safeScore: number | null = null
    if (typeof score === 'number' && Number.isFinite(score)) {
      safeScore = Math.max(0, Math.min(100, Math.round(score)))
    }

    const insertPayload = {
      user_id: user.id,
      type,
      scenario: scenario || null,
      score: safeScore,
      duration: typeof duration === 'number' ? duration : null,
      transcript: transcript || [],
      feedback: feedback || null,
    }

    const { data, error } = await supabase
      .from('sessions')
      .insert(insertPayload)
      .select('id')
      .single()

    if (error) {
      console.error('[api/sessions] insert failed', { error, payload: { ...insertPayload, transcript: `[${(transcript || []).length} entries]` } })
      return NextResponse.json({ error: error.message, details: error }, { status: 500 })
    }

    // Nota: `rankings` se actualiza automáticamente vía trigger `sessions_refresh_ranking_trg`
    // No es necesario llamar al RPC update_ranking desde aquí.

    console.log('[api/sessions] saved', data.id, 'score=', safeScore)
    return NextResponse.json({ id: data.id })
  } catch (err) {
    console.error('[api/sessions] exception', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error saving session' },
      { status: 500 }
    )
  }
}
