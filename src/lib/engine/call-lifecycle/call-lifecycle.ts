// Ciclo de vida de la llamada — decisiones deterministas (sin LLM).
//
// El modelo (vía function-calling end_call) aporta SOLO el juicio cualitativo:
// "¿terminó la conversación de forma natural y con qué reason?". Cuándo está
// PERMITIDO colgar, cuándo es FORZOSO (cap duro) y la ventana de aviso son reglas
// de código que se cumplen aunque el modelo se equivoque.

import {
  MAX_CALL_SECONDS,
  WARN_CALL_SECONDS,
  MIN_CALL_SECONDS,
  MIN_END_CALL_SECONDS_BY_TYPE,
  type CallType,
} from './limits'
import type { CallEndReason } from '../types'

const VALID_REASONS: readonly CallEndReason[] = [
  'cierre_exitoso',
  'objeciones_no_resueltas',
  'sin_interes',
  'timeout',
  'manual',
]

/**
 * Reasons que el MODELO puede usar para autocolgar, por tipo de práctica.
 *
 * Decisión de producto (híbrido): en modos de arco completo el USUARIO controla
 * el fin (cuelga cuando termina), y el modelo solo cierra en el caso clarísimo de
 * un cierre real. Los finales negativos (sin interés, objeciones sin resolver) los
 * decide el usuario colgando — así el modelo no corta la reunión a media práctica.
 * En 'objeciones' (drill) el modelo sí cierra solo al terminar la batería.
 */
const MODEL_END_REASONS_BY_TYPE: Record<CallType, readonly CallEndReason[]> = {
  objeciones: ['cierre_exitoso', 'objeciones_no_resueltas', 'sin_interes', 'timeout'],
  llamada_fria: ['cierre_exitoso', 'sin_interes', 'objeciones_no_resueltas'],
  framing: ['cierre_exitoso'],
  cierre: ['cierre_exitoso'],
  general: ['cierre_exitoso'],
}

/** Piso mínimo (segundos) para aceptar un end_call del modelo, según el tipo. */
export function minEndCallSeconds(type?: CallType): number {
  if (!type) return MIN_CALL_SECONDS
  return MIN_END_CALL_SECONDS_BY_TYPE[type] ?? MIN_CALL_SECONDS
}

/**
 * ¿Se permite que el modelo cuelgue ahora?
 *  - Debe haber pasado el piso mínimo de duración del tipo (anti-corte temprano).
 *  - El `reason` debe estar permitido para ese tipo (en arco completo solo
 *    cierre_exitoso; el resto los decide el usuario colgando).
 * Sin `type`, cae al guard global de 30s (compatibilidad).
 */
export function canModelEndCall(
  callAgeMs: number,
  opts?: { type?: CallType; reason?: CallEndReason },
): boolean {
  if (callAgeMs < minEndCallSeconds(opts?.type) * 1000) return false
  if (opts?.type && opts?.reason) {
    const allowed = MODEL_END_REASONS_BY_TYPE[opts.type]
    if (allowed && !allowed.includes(opts.reason)) return false
  }
  return true
}

/** ¿Alcanzó el cap duro de sesión? → auto-hangup. */
export function isHardCapReached(durationSeconds: number): boolean {
  return durationSeconds >= MAX_CALL_SECONDS
}

/** ¿Está en la ventana de aviso "quedan N minutos"? */
export function isWarningWindow(durationSeconds: number): boolean {
  return durationSeconds >= WARN_CALL_SECONDS && durationSeconds < MAX_CALL_SECONDS
}

/** Minutos restantes hasta el cap duro (mínimo 0). */
export function minutesRemaining(durationSeconds: number): number {
  return Math.max(0, Math.ceil((MAX_CALL_SECONDS - durationSeconds) / 60))
}

/**
 * Resuelve el `reason` final de forma determinista:
 *  - colgado manual del usuario → 'manual'
 *  - cap duro alcanzado → 'timeout' (override, sin importar lo que diga el modelo)
 *  - en otro caso, valida el reason del modelo contra el enum; si es inválido,
 *    cae a 'sin_interes' (cierre conservador y no triunfalista).
 */
export function resolveEndReason(input: {
  endedBy: 'user' | 'model'
  modelReason?: string
  hardCapReached: boolean
}): CallEndReason {
  if (input.endedBy === 'user') return 'manual'
  if (input.hardCapReached) return 'timeout'
  if (input.modelReason && (VALID_REASONS as readonly string[]).includes(input.modelReason)) {
    return input.modelReason as CallEndReason
  }
  return 'sin_interes'
}
