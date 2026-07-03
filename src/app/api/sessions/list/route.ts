import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()

    if (authErr) {
      console.error('[api/sessions/list] auth error', authErr)
    }
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Paginación: ?limit (máx 50, default 20) y ?offset (default 0).
    const url = new URL(request.url)
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20))
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)

    const { data, error } = await supabase
      .from('sessions')
      .select('id, type, scenario, score, duration, transcript, feedback, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('[api/sessions/list] query failed', error)
      return NextResponse.json({ error: error.message, details: error }, { status: 500 })
    }

    return NextResponse.json(data ?? [])
  } catch (err) {
    console.error('[api/sessions/list] exception', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error listing sessions' },
      { status: 500 }
    )
  }
}
