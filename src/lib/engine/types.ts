// Tipos de dominio compartidos por la capa-motor. Sin dependencias de React,
// Supabase ni red — para que cualquier módulo del motor pueda importarlos sin
// arrastrar el runtime de un hook o del cliente HTTP.

export type { CategoryKey, CategoryScores } from './scoring/weights'

/** Forma del transcript que produce el hook de voz (use-gemini-live). */
export interface LiveTranscriptEntry {
  role: 'user' | 'model'
  text: string
}

/** Origen de una evaluación: IA (Gemini) o fallback heurístico determinista. */
export type FeedbackSource = 'llm' | 'heuristic'

/**
 * Motivo por el que terminó la llamada. Fuente de verdad del tipo (antes vivía
 * en use-gemini-live.ts, que ahora lo re-exporta para no romper imports).
 */
export type CallEndReason =
  | 'cierre_exitoso'
  | 'objeciones_no_resueltas'
  | 'sin_interes'
  | 'timeout'
  | 'manual'
