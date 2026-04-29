import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()

    if (authErr) {
      console.error('[api/sessions/list] auth error', authErr)
    }
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabase
      .from('sessions')
      .select('id, type, scenario, score, duration, feedback, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)

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
