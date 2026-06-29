import { NextResponse } from 'next/server'
import { EVALUATION_PROMPT, type EvaluationResult } from '@/lib/prompts/evaluation'
import { createClient } from '@/lib/supabase/server'
import { enforceRateLimit } from '@/lib/rate-limit'
import { normalizeCategoryScores, computeOverallScore } from '@/lib/engine'
import { log, estimateEvalCostUsd } from '@/lib/log'

// Models confirmed available for this API key (via ListModels)
// All use v1beta which supports responseMimeType JSON mode
const MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-flash-latest',
]
const API_VERSION = 'v1beta'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Extract JSON from model response even if it wraps in ```json ... ```
function extractJSON(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end !== -1) return text.slice(start, end + 1)
  return text.trim()
}

export async function POST(request: Request) {
  // Auth check — solo usuarios autenticados pueden disparar evaluaciones (cuestan dinero)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  // Rate limit: máximo 10 evaluaciones por hora por usuario.
  // Una sesión real produce 1 evaluación; este límite ataja bucles y abusos.
  const limited = await enforceRateLimit(`evaluate:${user.id}`, {
    capacity: 10,
    windowMs: 60 * 60 * 1000,
  })
  if (limited) return limited

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Gemini API key not configured' }, { status: 500 })
  }

  try {
    const { transcript } = await request.json()

    if (!transcript || typeof transcript !== 'string') {
      return NextResponse.json({ error: 'Invalid transcript' }, { status: 400 })
    }

    // Límite de tamaño: 40 KB máximo. Un transcript de roleplay real de 45 min
    // tiene ~15-20 KB — 40 KB es margen generoso sin permitir abusos.
    if (transcript.length > 40_000) {
      return NextResponse.json({ error: 'Transcript demasiado largo' }, { status: 400 })
    }

    const body = JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `${EVALUATION_PROMPT}\n\n---\n\nTRANSCRIPCIÓN DE LA LLAMADA:\n\n${transcript}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json',
      },
    })

    let res: Response | null = null
    let lastError = ''

    for (const model of MODELS) {
      const url = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${model}:generateContent?key=${apiKey}`
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 55_000)

      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        })
        clearTimeout(timeout)

        if (res.ok) {
          console.log(`[evaluate] ✓ OK — model: ${model}`)
          break
        }

        // Log the actual error body from Gemini for debugging
        const errBody = await res.text()
        console.warn(`[evaluate] ${model} → ${res.status}: ${errBody.slice(0, 300)}`)
        lastError = `${model} ${res.status}`

        // Rate limited: wait 4s and retry once
        if (res.status === 429) {
          console.warn(`[evaluate] rate limited — waiting 4s before retry`)
          await sleep(4000)
          const c2 = new AbortController()
          const t2 = setTimeout(() => c2.abort(), 55_000)
          try {
            res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body,
              signal: c2.signal,
            })
            clearTimeout(t2)
            if (res.ok) {
              console.log(`[evaluate] ✓ OK after retry — model: ${model}`)
              break
            }
            const errBody2 = await res.text()
            console.warn(`[evaluate] retry ${model} → ${res.status}: ${errBody2.slice(0, 200)}`)
          } catch {
            clearTimeout(t2)
          }
        }
      } catch (fetchErr) {
        clearTimeout(timeout)
        lastError = `${model} fetch error: ${fetchErr}`
        console.warn(`[evaluate] ${lastError}`)
      }
    }

    if (!res || !res.ok) {
      return NextResponse.json(
        { error: `No se pudo conectar con el evaluador. ${lastError}` },
        { status: 503 }
      )
    }

    const data = await res.json()
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text

    if (!raw) {
      console.error('[evaluate] empty response:', JSON.stringify(data).slice(0, 300))
      return NextResponse.json({ error: 'Empty response from Gemini' }, { status: 500 })
    }

    const parsed = JSON.parse(extractJSON(raw)) as Record<string, unknown>

    // Las 6 categorías cualitativas las decide el modelo (requiere IA); el promedio
    // ponderado lo calcula el MOTOR de forma determinista. Cualquier
    // `puntuacion_general` que devuelva el LLM se ignora a propósito.
    const categories = normalizeCategoryScores(parsed)
    const puntuacion_general = computeOverallScore(categories)

    // Telemetría temporal: comparar el general del modelo vs el recalculado.
    if (typeof parsed.puntuacion_general === 'number' && Math.round(parsed.puntuacion_general) !== puntuacion_general) {
      console.log(
        '[evaluate] puntuacion_general modelo=%d recalculado=%d',
        Math.round(parsed.puntuacion_general),
        puntuacion_general,
      )
    }

    const evaluation: EvaluationResult = {
      ...categories,
      puntuacion_general,
      feedback_positivo: typeof parsed.feedback_positivo === 'string' ? parsed.feedback_positivo : '',
      feedback_mejora: typeof parsed.feedback_mejora === 'string' ? parsed.feedback_mejora : '',
      momento_critico: typeof parsed.momento_critico === 'string' ? parsed.momento_critico : '',
      feedback_source: 'llm',
    }

    // Metering de costo de la evaluación (usageMetadata de Gemini).
    const usage = data.usageMetadata ?? {}
    const inTok = Number(usage.promptTokenCount ?? 0)
    const outTok = Number(usage.candidatesTokenCount ?? 0)
    log.cost('evaluate', {
      userId: user.id,
      evalInputTokens: inTok,
      evalOutputTokens: outTok,
      estEvalCostUsd: Number(estimateEvalCostUsd(inTok, outTok).toFixed(5)),
    })

    return NextResponse.json(evaluation)
  } catch (err) {
    console.error('[evaluate] exception:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Evaluation error' },
      { status: 500 }
    )
  }
}
