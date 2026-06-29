import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminRpc, hasServiceRole } from '@/lib/supabase/admin'
import { log, estimateVoiceCostUsd } from '@/lib/log'

export const dynamic = 'force-dynamic'

const MAX_REASONABLE_SECONDS = 60 * 60

// POST /api/sessions/end { sessionId, actualSeconds } — cierra la reserva y
// concilia el consumo real contra la cuota diaria. No-op si no hay service-role.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  if (!hasServiceRole()) return NextResponse.json({ ok: true })

  const body = await request.json().catch(() => null)
  const sessionId = body && typeof body.sessionId === 'string' ? body.sessionId : null
  const rawSeconds = body && typeof body.actualSeconds === 'number' ? body.actualSeconds : 0
  const actualSeconds = Math.max(0, Math.min(MAX_REASONABLE_SECONDS, Math.round(rawSeconds)))
  if (!sessionId) return NextResponse.json({ ok: true })

  try {
    await adminRpc('end_session', { p_session_id: sessionId, p_actual_seconds: actualSeconds })
    log.cost('sessions/end', {
      userId: user.id,
      sessionId,
      voiceSeconds: actualSeconds,
      estVoiceCostUsd: Number(estimateVoiceCostUsd(actualSeconds).toFixed(4)),
    })
  } catch (e) {
    log.warn('sessions/end', 'end_session failed', { userId: user.id, sessionId, err: String(e) })
  }
  return NextResponse.json({ ok: true })
}
