import { NextRequest, NextResponse } from 'next/server'
import { adminRpc, hasServiceRole } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// GET /api/cron/reap — cierra sesiones de voz huérfanas (sin heartbeat) y libera
// sus reservas de cuota. Protegido con CRON_SECRET (lo llama Vercel Cron).
// Red de seguridad: el propio start_session ya hace reap inline en cada inicio.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!hasServiceRole()) {
    return NextResponse.json({ ok: true, skipped: 'no service role configured' })
  }

  try {
    const { data, error } = await adminRpc<number>('reap_stale_sessions', { p_stale_seconds: 90 })
    if (error) {
      console.error('[cron/reap] reap_stale_sessions failed', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, reaped: data ?? 0, timestamp: new Date().toISOString() })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
