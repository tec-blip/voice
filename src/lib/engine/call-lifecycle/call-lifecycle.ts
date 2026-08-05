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
  MATURE_CLOSE_SECONDS,
  MATURE_CLOSE_SECONDS_BY_TYPE,
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
 * En ARCO COMPLETO (general, cierre, llamada_fria, framing) el prospecto NUNCA
 * cuelga: quien termina la llamada es el VENDEDOR (colgando, reason 'manual') o el
 * cap duro. Por eso bloqueamos TODOS los reasons del modelo en estos tipos —no solo
 * 'cierre_exitoso'. Esto evita dos cortes reales reportados:
 *   - Ivan: la IA daba la venta por cerrada sobre un "sí" y colgaba a mitad del pitch.
 *   - Ana/otros: la IA colgaba con 'timeout' ante una pausa o silencio, cortando la
 *     práctica antes de que el vendedor pudiera hacer el discovery.
 * Cuando se bloquea, el hook re-engancha al modelo para que siga de prospecto y deje
 * que el vendedor dirija (nunca queda mudo). El vendedor siempre puede colgar él.
 *
 * SOLO el drill de 'objeciones' permite que el modelo cierre: ese modo termina, por
 * diseño, cuando el prospecto se convence ('cierre_exitoso') o se rinde
 * ('objeciones_no_resueltas' / 'timeout').
 */
export function canModelUseReason(reason: string, type?: CallType): boolean {
  if (!(VALID_REASONS as readonly string[]).includes(reason)) return false
  // 'manual' es del usuario, nunca del modelo.
  if (reason === 'manual') return false
  // Arco completo: el modelo no cierra la llamada por ningún motivo.
  if (type !== 'objeciones') return false
  return true
}

/** ¿Alcanzó el cap duro de sesión? → auto-hangup. */
export function isHardCapReached(durationSeconds: number): boolean {
  return durationSeconds >= MAX_CALL_SECONDS
}

/**
 * ¿Un end_call('cierre_exitoso') del modelo en arco completo representa un cierre
 * MADURO (la venta realmente se cerró tras el pitch) y no un soft-yes prematuro?
 *
 * NO autoriza a colgar (canModelUseReason sigue bloqueando el auto-hangup del
 * modelo en arco completo). Solo sirve para que la UI decida si mostrar el aviso
 * "venta cerrada" al alumno. En 'objeciones' el cierre lo maneja el flujo normal,
 * así que aquí devolvemos false (no aplica el aviso híbrido).
 */
export function isMatureClose(callAgeMs: number, type?: CallType): boolean {
  if (type === 'objeciones') return false
  const threshold = (type && MATURE_CLOSE_SECONDS_BY_TYPE[type]) ?? MATURE_CLOSE_SECONDS
  return callAgeMs >= threshold * 1000
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
