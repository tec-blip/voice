/**
 * Badge award logic.
 *
 * Se ejecuta después de guardar una sesión. Lee todas las sesiones del usuario
 * + el ranking actual, calcula qué badges debería tener y persiste la unión
 * (no se quitan badges una vez ganados).
 *
 * Coste: 1 SELECT a sessions + 1 SELECT a rankings + 1 UPDATE a rankings (solo
 * si hubo cambio). Es una operación rápida — no se paraleliza con la respuesta
 * al cliente porque queremos que el siguiente fetch del perfil ya las muestre.
 */

import type { createClient } from '@/lib/supabase/server'
import type { FeedbackScores, RoleplayType, TranscriptEntry } from '@/lib/types/database'

// El cliente de servidor no está parametrizado con `Database`, así que tipamos
// el parámetro a partir del retorno real de createClient(). Eso evita los
// `never` que aparecen cuando se usa SupabaseClient<Database> con un cliente
// que internamente es SupabaseClient<any, any, any>.
type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

const ALL_TYPES: RoleplayType[] = ['cierre', 'llamada_fria', 'framing', 'general', 'objeciones']

interface SessionMin {
  type: RoleplayType
  score: number | null
  feedback: FeedbackScores | null
  created_at: string
}

function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}

function computeStreak(daysSet: Set<string>): number {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const todayKey = today.toISOString().slice(0, 10)
  const yesterday = new Date(today)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const yesterdayKey = yesterday.toISOString().slice(0, 10)

  // La racha cuenta si hubo sesión hoy o ayer (no se rompe por no haber
  // practicado todavía hoy). Si tampoco hubo ayer, racha = 0.
  let cursor: Date
  if (daysSet.has(todayKey)) cursor = today
  else if (daysSet.has(yesterdayKey)) cursor = yesterday
  else return 0

  let streak = 0
  for (let i = 0; i < 60; i++) {
    const d = new Date(cursor)
    d.setUTCDate(d.getUTCDate() - i)
    const key = d.toISOString().slice(0, 10)
    if (daysSet.has(key)) streak++
    else break
  }
  return streak
}

export async function evaluateBadges(
  userId: string,
  supabase: SupabaseServerClient,
): Promise<string[]> {
  const [sessionsRes, rankingRes] = await Promise.all([
    supabase
      .from('sessions')
      .select('type, score, feedback, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('rankings')
      .select('badges')
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  const sessions = (sessionsRes.data ?? []) as unknown as SessionMin[]
  const rankingData = rankingRes.data as { badges?: unknown } | null
  const existingRaw = rankingData?.badges
  const existing = new Set<string>(Array.isArray(existingRaw) ? (existingRaw as string[]) : [])
  const earned = new Set<string>(existing)

  const completed = sessions.filter((s) => typeof s.score === 'number')

  // first_call — al menos 1 sesión completada
  if (completed.length >= 1) earned.add('first_call')

  // sessions_10 / sessions_50
  if (completed.length >= 10) earned.add('sessions_10')
  if (completed.length >= 50) earned.add('sessions_50')

  // score_80 / score_90
  if (completed.some((s) => (s.score ?? 0) >= 80)) earned.add('score_80')
  if (completed.some((s) => (s.score ?? 0) >= 90)) earned.add('score_90')

  // perfect_close — categoría "cierre" >= 90 en alguna sesión
  if (
    completed.some((s) => {
      const f = s.feedback
      return f && typeof f.cierre === 'number' && f.cierre >= 90
    })
  ) {
    earned.add('perfect_close')
  }

  // all_types — practicó los 5 tipos al menos una vez
  const typesSeen = new Set(completed.map((s) => s.type))
  if (ALL_TYPES.every((t) => typesSeen.has(t))) earned.add('all_types')

  // improvement — 3 sesiones consecutivas (más recientes) con scores ascendentes
  if (completed.length >= 3) {
    const last3 = completed.slice(0, 3).map((s) => s.score!).reverse()
    if (last3[0] < last3[1] && last3[1] < last3[2]) earned.add('improvement')
  }

  // streak_3 / streak_7
  const days = new Set(completed.map((s) => dayKey(s.created_at)))
  const streak = computeStreak(days)
  if (streak >= 3) earned.add('streak_3')
  if (streak >= 7) earned.add('streak_7')

  const final = Array.from(earned).sort()
  const existingSorted = Array.from(existing).sort()

  // Solo escribimos si hay diferencia real
  const changed =
    final.length !== existingSorted.length ||
    final.some((b, i) => b !== existingSorted[i])

  if (changed) {
    const { error } = await supabase
      .from('rankings')
      .update({ badges: final })
      .eq('user_id', userId)
    if (error) {
      console.warn('[badges] update failed', error.message)
    }
  }

  return final
}

// Re-exportado para que sessions/route.ts pueda tipar transcript sin importar
// el tipo desde dos sitios distintos.
export type { TranscriptEntry }
