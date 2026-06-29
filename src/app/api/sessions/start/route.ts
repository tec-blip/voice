import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminRpc, hasServiceRole } from '@/lib/supabase/admin'
import { enforceRateLimit } from '@/lib/rate-limit'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'

const DAILY_LIMIT_SECONDS = 60 * 60 // 1 hora/día/usuario
const MAX_CONCURRENT = 1
const RESERVE_SECONDS = 600 // reserva inicial por llamada (se concilia al cerrar)

// POST /api/sessions/start — reserva una sesión de voz ANTES de pedir el token.
// Enforce concurrencia + cuota diaria de forma atómica (RPC start_session).
// Si no hay service-role configurado, cae al check de cuota legacy (sessions
// terminadas) y devuelve sessionId=null (sin control de concurrencia).
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const limited = await enforceRateLimit(`session-start:${user.id}`, { capacity: 6, windowMs: 60 * 1000 })
  if (limited) return limited

  // ── Camino con backend de control de costo ────────────────────────────────
  if (hasServiceRole()) {
    try {
      const { data, error } = await adminRpc<string>('start_session', {
        p_user_id: user.id,
        p_max_concurrent: MAX_CONCURRENT,
        p_daily_limit_seconds: DAILY_LIMIT_SECONDS,
        p_reserve_seconds: RESERVE_SECONDS,
      })
      if (error) {
        const msg = error.message ?? ''
        if (msg.includes('concurrent_limit')) {
          return NextResponse.json(
            { error: 'Ya tienes una llamada activa. Ciérrala antes de iniciar otra.', code: 'CONCURRENT_LIMIT' },
            { status: 429 },
          )
        }
        if (msg.includes('daily_limit')) {
          return NextResponse.json(
            { error: '¡Alcanzaste tu límite diario de práctica (60 min)! Vuelve mañana con energía 💪', code: 'DAILY_LIMIT_REACHED' },
            { status: 429 },
          )
        }
        // Error inesperado (ej. migración 003 aún no aplicada): no bloqueamos,
        // caemos al check legacy.
        log.warn('sessions/start', 'start_session rpc error, falling back', { userId: user.id, err: msg })
      } else {
        log.info('sessions/start', 'session reserved', { userId: user.id, sessionId: String(data) })
        return NextResponse.json({ sessionId: data })
      }
    } catch (e) {
      log.warn('sessions/start', 'admin client unavailable, falling back', { userId: user.id, err: String(e) })
    }
  }

  // ── Fallback legacy: cuota diaria basada en sesiones terminadas ────────────
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const { data: todaySessions } = await supabase
    .from('sessions')
    .select('duration')
    .eq('user_id', user.id)
    .gte('created_at', todayStart.toISOString())

  const totalSecondsToday = (todaySessions ?? []).reduce(
    (sum, s) => sum + (typeof s.duration === 'number' ? s.duration : 0),
    0,
  )
  if (totalSecondsToday >= DAILY_LIMIT_SECONDS) {
    const usedMin = Math.round(totalSecondsToday / 60)
    return NextResponse.json(
      { error: `Has alcanzado tu límite diario de práctica (${usedMin} min usados, máximo 60 min). ¡Vuelve mañana! 💪`, code: 'DAILY_LIMIT_REACHED' },
      { status: 429 },
    )
  }

  return NextResponse.json({ sessionId: null })
}
