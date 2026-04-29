import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { evaluateBadges } from '@/lib/utils/badge-logic'
import type { RoleplayType, TranscriptEntry, FeedbackScores } from '@/lib/types/database'

const ALLOWED_TYPES: RoleplayType[] = [
  'cierre', 'llamada_fria', 'framing', 'general', 'objeciones',
]

const MAX_DURATION_SECONDS = 60 * 60        // 1 hora — alineado con el cap de la sesión
const MAX_TRANSCRIPT_ENTRIES = 800          // ~45 min × ~15 turnos/min con margen
const MAX_TRANSCRIPT_TEXT_LENGTH = 4000     // por entrada
const MAX_SCENARIO_LENGTH = 8000

function isValidTranscriptEntry(e: unknown): e is TranscriptEntry {
  if (!e || typeof e !== 'object') return false
  const x = e as Record<string, unknown>
  if (x.role !== 'user' && x.role !== 'assistant') return false
  if (typeof x.content !== 'string') return false
  if (x.content.length > MAX_TRANSCRIPT_TEXT_LENGTH) return false
  if (typeof x.timestamp !== 'string') return false
  return true
}

function sanitizeFeedback(f: unknown): FeedbackScores | null {
  if (!f || typeof f !== 'object') return null
  const x = f as Record<string, unknown>
  const numFields = ['apertura', 'descubrimiento', 'presentacion', 'objeciones', 'cierre', 'tono'] as const
  const out: Record<string, unknown> = {}
  for (const k of numFields) {
    const v = x[k]
    if (typeof v !== 'number' || !Number.isFinite(v)) return null
    out[k] = Math.max(0, Math.min(100, Math.round(v)))
  }
  out.feedback_positivo = typeof x.feedback_positivo === 'string' ? x.feedback_positivo.slice(0, 2000) : ''
  out.feedback_mejora   = typeof x.feedback_mejora   === 'string' ? x.feedback_mejora.slice(0, 2000)   : ''
  out.momento_critico   = typeof x.momento_critico   === 'string' ? x.momento_critico.slice(0, 2000)   : null
  return out as unknown as FeedbackScores
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      console.warn('[api/sessions] POST — no user from getUser()')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
    const { type, scenario, score, duration, transcript, feedback } = body as Record<string, unknown>

    // ── type ────────────────────────────────────────────────────────────────
    if (typeof type !== 'string' || !ALLOWED_TYPES.includes(type as RoleplayType)) {
      return NextResponse.json({ error: 'Tipo de roleplay inválido' }, { status: 400 })
    }

    // ── score ───────────────────────────────────────────────────────────────
    let safeScore: number | null = null
    if (score !== undefined && score !== null) {
      if (typeof score !== 'number' || !Number.isFinite(score)) {
        return NextResponse.json({ error: 'Score inválido' }, { status: 400 })
      }
      safeScore = Math.max(0, Math.min(100, Math.round(score)))
    }

    // ── duration ────────────────────────────────────────────────────────────
    let safeDuration: number | null = null
    if (duration !== undefined && duration !== null) {
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
        return NextResponse.json({ error: 'Duración inválida' }, { status: 400 })
      }
      safeDuration = Math.min(MAX_DURATION_SECONDS, Math.round(duration))
    }

    // ── scenario ────────────────────────────────────────────────────────────
    let safeScenario: string | null = null
    if (scenario !== undefined && scenario !== null) {
      if (typeof scenario !== 'string') {
        return NextResponse.json({ error: 'Scenario inválido' }, { status: 400 })
      }
      if (scenario.length > MAX_SCENARIO_LENGTH) {
        return NextResponse.json({ error: 'Scenario demasiado largo' }, { status: 400 })
      }
      safeScenario = scenario
    }

    // ── transcript ──────────────────────────────────────────────────────────
    let safeTranscript: TranscriptEntry[] = []
    if (transcript !== undefined && transcript !== null) {
      if (!Array.isArray(transcript)) {
        return NextResponse.json({ error: 'Transcript inválido' }, { status: 400 })
      }
      if (transcript.length > MAX_TRANSCRIPT_ENTRIES) {
        return NextResponse.json({ error: 'Transcript demasiado largo' }, { status: 400 })
      }
      if (!transcript.every(isValidTranscriptEntry)) {
        return NextResponse.json({ error: 'Entradas de transcript inválidas' }, { status: 400 })
      }
      safeTranscript = transcript
    }

    // ── feedback ────────────────────────────────────────────────────────────
    const safeFeedback = feedback === undefined || feedback === null ? null : sanitizeFeedback(feedback)
    if (feedback && !safeFeedback) {
      return NextResponse.json({ error: 'Feedback con formato inválido' }, { status: 400 })
    }

    const insertPayload = {
      user_id: user.id,
      type: type as RoleplayType,
      scenario: safeScenario,
      score: safeScore,
      duration: safeDuration,
      transcript: safeTranscript,
      feedback: safeFeedback,
    }

    const { data, error } = await supabase
      .from('sessions')
      .insert(insertPayload)
      .select('id')
      .single()

    if (error) {
      console.error('[api/sessions] insert failed', {
        error: error.message,
        type: insertPayload.type,
        score: insertPayload.score,
        duration: insertPayload.duration,
        transcript_entries: safeTranscript.length,
      })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Nota: `rankings` (sessions_count, avg_score, total_score) se actualiza
    // automáticamente vía trigger `sessions_refresh_ranking_trg`.
    // Aquí solo evaluamos badges — es independiente del recálculo de stats.
    let badges: string[] = []
    try {
      badges = await evaluateBadges(user.id, supabase)
    } catch (badgeErr) {
      // No bloqueamos la respuesta si fallan los badges.
      console.warn('[api/sessions] badge evaluation failed', badgeErr)
    }

    console.log('[api/sessions] saved', data.id, 'score=', safeScore, 'badges=', badges.length)
    return NextResponse.json({ id: data.id, badges })
  } catch (err) {
    console.error('[api/sessions] exception', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error saving session' },
      { status: 500 }
    )
  }
}
