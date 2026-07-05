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

/** Piso mínimo (segundos) para aceptar un end_call del modelo, según el tipo. */
export function minEndCallSeconds(type?: CallType): number {
  if (!type) return MIN_CALL_SECONDS
  return MIN_END_CALL_SECONDS_BY_TYPE[type] ?? MIN_CALL_SECONDS
}

/**
 * ¿Se permite que el modelo cuelgue ahora (por DURACIÓN)? Único criterio aquí:
 * que haya pasado el piso mínimo de duración del tipo (backstop anti-corte-temprano).
 * El filtro por `reason` es aparte (canModelUseReason).
 *
 * Cuando este guard bloquea, el hook RE-ENGANCHA al modelo (clientContent) para
 * que nunca se quede mudo.
 */
export function canModelEndCall(callAgeMs: number, type?: CallType): boolean {
  return callAgeMs >= minEndCallSeconds(type) * 1000
}

/**
 * ¿Puede el MODELO (prospecto) terminar la llamada con este `reason`, según el tipo?
 *
 * En ARCO COMPLETO (general, cierre, llamada_fria, framing) un CIERRE EXITOSO lo
 * declara el HUMANO colgando (reason 'manual'), NO el prospecto. Si el modelo
 * autocuelga con 'cierre_exitoso' apenas el prospecto dice "sí", corta al closer
 * ANTES del pitch y del cierre logístico real (bug reportado por Ivan: la IA dio
 * la venta por cerrada sobre un soft-yes y colgó a mitad del pitch). Por eso el
 * modelo NO puede autocerrar con 'cierre_exitoso' en estos tipos — solo con
 * finales negativos/neutros (sin_interes, objeciones_no_resueltas, timeout).
 * Cuando se bloquea, el hook re-engancha al modelo para que siga de prospecto y
 * empuje al vendedor a presentar y cerrar (nunca queda mudo).
 *
 * En el drill de 'objeciones' SÍ se permite 'cierre_exitoso': ese modo termina,
 * por diseño, cuando el prospecto se convence tras resolver sus barreras.
 */
export function canModelUseReason(reason: string, type?: CallType): boolean {
  if (!(VALID_REASONS as readonly string[]).includes(reason)) return false
  // 'manual' es del usuario, nunca del modelo.
  if (reason === 'manual') return false
  if (reason === 'cierre_exitoso' && type !== 'objeciones') return false
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
