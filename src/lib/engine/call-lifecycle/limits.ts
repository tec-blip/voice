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

/**
 * Piso mínimo para considerar "maduro" un cierre exitoso en modos de arco
 * completo (general/cierre/llamada_fria/framing). El modelo NUNCA cuelga solo
 * en estos modos (eso lo sigue bloqueando canModelUseReason — protege contra el
 * cierre prematuro sobre un "sí" temprano). Este umbral solo decide CUÁNDO la UI
 * puede mostrar el aviso "venta cerrada, cuelga para ver tu evaluación": antes de
 * este tiempo, un end_call('cierre_exitoso') se trata como soft-yes prematuro y
 * NO dispara el aviso. Es puramente informativo, no cambia el ciclo de vida.
 */
export const MATURE_CLOSE_SECONDS = 5 * 60 // 300 (default arco completo)

/**
 * Umbral de "cierre maduro" POR TIPO. En 'cierre' el pitch ya ocurrió en la
 * llamada previa, así que un cierre a los ~1.5 min es legítimo (reportado por
 * testers: cerraban rápido y el sistema lo trataba como "sí" prematuro, sin
 * mostrar el aviso). Los tipos no listados usan MATURE_CLOSE_SECONDS (5 min).
 */
export const MATURE_CLOSE_SECONDS_BY_TYPE: Partial<Record<CallType, number>> = {
  cierre: 90,
}
