// Límites de duración de la llamada — ÚNICA fuente de verdad.
//
// Antes vivían duplicados: como constantes en phone-ui.tsx (cap 45 min, guardia
// 30s) Y como directivas de texto en roleplay.ts ("nunca antes de 5 min",
// "timeout a 8-10 min"), que se contradecían. Ahora el código manda; el prompt
// solo describe el criterio cualitativo de cuándo es apropiado colgar.

/** Duración mínima antes de aceptar un end_call del modelo (anti barge-in). */
export const EARLY_END_GUARD_MS = 30_000

/** Equivalente en segundos de la guardia mínima (fallback si no hay tipo). */
export const MIN_CALL_SECONDS = 30

/** Tipos de práctica (espejo de RoleplayType en prompts/roleplay; aquí como
 *  strings puros para que el motor no dependa de esa capa). */
export type CallType = 'cierre' | 'llamada_fria' | 'framing' | 'objeciones' | 'general'

/**
 * Piso mínimo (segundos) antes de aceptar un end_call del modelo, por tipo.
 *
 * SOLO sirve de backstop para cortes absurdamente tempranos (los reportados al
 * principio: cuelgues a los 30s en pleno saludo). El control real de "no colgar
 * antes de tiempo" lo hace el PROMPT (engine no puede saber si la conversación
 * tuvo sentido). Pisos BAJOS a propósito: un piso alto bloqueaba end_calls
 * legítimos al cierre y congelaba al modelo (caso real de un tester). Pasado el
 * piso, se acepta cualquier cierre y el prompt decide si fue apropiado.
 */
export const MIN_END_CALL_SECONDS_BY_TYPE: Record<CallType, number> = {
  objeciones: 30,
  llamada_fria: 45,
  framing: 60,
  cierre: 75,
  general: 90,
}

/** Cap duro de la sesión: a este punto se cuelga automáticamente. */
export const MAX_CALL_SECONDS = 45 * 60 // 2700

/** Inicio de la ventana de aviso "quedan N minutos". */
export const WARN_CALL_SECONDS = 40 * 60 // 2400
