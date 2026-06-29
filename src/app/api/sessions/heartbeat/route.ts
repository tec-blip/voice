import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminRpc, hasServiceRole } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// POST /api/sessions/heartbeat { sessionId } — mantiene viva la reserva durante
// la llamada (el reaper cierra sesiones sin heartbeat reciente). No-op si no hay
// service-role o sessionId.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  if (!hasServiceRole()) return NextResponse.json({ ok: true })

  const body = await request.json().catch(() => null)
  const sessionId = body && typeof body.sessionId === 'string' ? body.sessionId : null
  if (!sessionId) return NextResponse.json({ ok: true })

  try {
    await adminRpc('heartbeat_session', { p_session_id: sessionId })
  } catch {
    // best-effort: el reaper es la red de seguridad
  }
  return NextResponse.json({ ok: true })
}
