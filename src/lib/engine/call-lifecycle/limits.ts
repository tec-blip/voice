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
 * Motivado por datos reales: las llamadas buenas duran 6-9 min; las que los
 * usuarios reportaron como "se cortó al principio" morían a los 30-90s — justo
 * pasado el guard global de 30s. Cada modo necesita un arco mínimo distinto:
 * un drill de objeciones puede cerrar rápido; una llamada de arco completo no.
 */
export const MIN_END_CALL_SECONDS_BY_TYPE: Record<CallType, number> = {
  objeciones: 45,    // drill: puede cerrar al terminar la batería
  llamada_fria: 75,  // una fría puede morir pronto, pero no en 30s
  framing: 150,
  cierre: 180,
  general: 210,      // arco completo (marco→dolor→visión→VSO→pitch→cierre)
}

/** Cap duro de la sesión: a este punto se cuelga automáticamente. */
export const MAX_CALL_SECONDS = 45 * 60 // 2700

/** Inicio de la ventana de aviso "quedan N minutos". */
export const WARN_CALL_SECONDS = 40 * 60 // 2400
