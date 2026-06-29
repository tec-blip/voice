// Scorer heurístico determinista — funciona SIN LLM.
//
// Fallback cuando Gemini no está disponible (caído / sin API key / error). NO
// pretende la precisión del evaluador IA: produce un score provisional, plausible
// y reproducible a partir de señales objetivas del transcript (turnos, preguntas,
// keywords de cada fase de la metodología). Se marca con feedback_source:'heuristic'
// para que la UI lo muestre como "evaluación provisional".

import type { LiveTranscriptEntry } from '../types'
import type { CategoryScores } from './weights'
import { clampScore, computeOverallScore } from './scoring'

export interface HeuristicResult {
  scores: CategoryScores
  puntuacion_general: number
  feedback_positivo: string
  feedback_mejora: string
  momento_critico: string
  notas: string[]
}

// Keywords por fase de la Metodología Luis Romero (en minúsculas, sin exigir tildes
// exactas en todos los casos — es heurístico).
const APERTURA_KW = ['como vamos', 'cómo vamos', 'al final decidimos', 'por que agendaste', 'por qué agendaste', 'tiene sentido', 'te explico', 'permiso']
const DESCUBRIMIENTO_KW = ['que te pesa', 'qué te pesa', 'cuanto', 'cuánto', 'como te ves', 'cómo te ves', 'que has intentado', 'qué has intentado', 'que necesitas', 'qué necesitas', 'si seguimos asi', 'si seguimos así']
const PRESENTACION_KW = ['dejame ver si te entendi', 'déjame ver si te entendí', 'recuerda que me dijiste', 'resumen', 'esto encaja', 'como lo ves', 'cómo lo ves']
const OBJECIONES_KW = ['entiendo', 'precisamente por eso', 'coste', 'cuotas', 'seguir como estas', 'seguir como estás', 'dividimos']
const CIERRE_KW = ['comenzamos', 'siguiente paso', 'tarjeta', 'decides hoy', 'empezamos', 'cerramos', 'comienzas hoy']

function countMatches(text: string, kws: string[]): number {
  let n = 0
  for (const kw of kws) {
    if (text.includes(kw)) n++
  }
  return n
}

const BASE = 30 // piso para una llamada con poca señal

/**
 * Estima las 6 categorías + puntuación general de forma determinista.
 * Mismo transcript → mismo resultado, siempre.
 */
export function estimateScoresHeuristic(entries: LiveTranscriptEntry[]): HeuristicResult {
  const seller = entries.filter((e) => e.role === 'user')
  const prospect = entries.filter((e) => e.role === 'model')

  const sellerText = seller.map((e) => e.text).join(' ').toLowerCase()
  const sellerChars = sellerText.length
  const prospectChars = prospect.map((e) => e.text).join(' ').length
  const questions = (sellerText.match(/\?/g) ?? []).length
  const sellerTurns = seller.length

  // Ratio de habla: un closer no debe monopolizar. Penaliza si habla >70% o <20%.
  const total = sellerChars + prospectChars
  const talkRatio = total > 0 ? sellerChars / total : 0
  const balanceBonus = talkRatio >= 0.2 && talkRatio <= 0.7 ? 12 : 0

  const notas: string[] = []
  const add = (cond: boolean, nota: string) => { if (cond) notas.push(nota) }

  const aperturaHits = countMatches(sellerText, APERTURA_KW)
  const descubrimientoHits = countMatches(sellerText, DESCUBRIMIENTO_KW)
  const presentacionHits = countMatches(sellerText, PRESENTACION_KW)
  const objecionesHits = countMatches(sellerText, OBJECIONES_KW)
  const cierreHits = countMatches(sellerText, CIERRE_KW)

  add(aperturaHits > 0, 'Estableció marco/apertura.')
  add(questions >= 3, `Hizo ${questions} preguntas de descubrimiento.`)
  add(presentacionHits > 0, 'Usó resumen espejo o chequeo de comprensión.')
  add(objecionesHits > 0, 'Abordó objeciones redirigiendo al dolor.')
  add(cierreHits > 0, 'Intentó un cierre explícito.')

  const scores: CategoryScores = {
    apertura: clampScore(BASE + aperturaHits * 14 + (sellerTurns >= 2 ? 10 : 0)),
    descubrimiento: clampScore(BASE + Math.min(questions, 6) * 7 + descubrimientoHits * 6),
    presentacion: clampScore(BASE + presentacionHits * 16 + balanceBonus),
    objeciones: clampScore(BASE + objecionesHits * 13 + (prospect.length >= 3 ? 8 : 0)),
    cierre: clampScore(BASE + cierreHits * 18),
    tono: clampScore(BASE + balanceBonus + Math.min(sellerTurns, 8) * 4),
  }

  const puntuacion_general = computeOverallScore(scores)

  const fortalezas = notas.length
    ? notas.join(' ')
    : 'Completaste la llamada. Aún hay poca señal de las fases de la metodología.'

  const faltantes: string[] = []
  if (aperturaHits === 0) faltantes.push('establecer el marco de la llamada al inicio')
  if (questions < 3) faltantes.push('profundizar más en el descubrimiento con preguntas')
  if (presentacionHits === 0) faltantes.push('hacer un resumen espejo antes del pitch')
  if (cierreHits === 0) faltantes.push('cerrar con dirección clara')
  const mejora = faltantes.length
    ? `Para mejorar: ${faltantes.join('; ')}.`
    : 'Buen recorrido por las fases; pule la consistencia y los silencios estratégicos.'

  return {
    scores,
    puntuacion_general,
    feedback_positivo: fortalezas,
    feedback_mejora: mejora,
    momento_critico: 'Evaluación provisional generada sin IA (la evaluación detallada no estuvo disponible).',
    notas,
  }
}
