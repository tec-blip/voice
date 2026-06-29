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
 * ¿Se permite que el modelo cuelgue ahora? Único criterio: que haya pasado el
 * piso mínimo de duración del tipo (backstop anti-corte-temprano).
 *
 * NO filtramos por `reason`: bloquear un end_call legítimo (p.ej. al cierre)
 * dejaba al modelo congelado en silencio en vez de continuar. Si el cierre es
 * inapropiado, lo evita el PROMPT; el código solo frena lo absurdamente temprano.
 * Cuando este guard bloquea, el hook RE-ENGANCHA al modelo (clientContent) para
 * que nunca se quede mudo.
 */
export function canModelEndCall(callAgeMs: number, type?: CallType): boolean {
  return callAgeMs >= minEndCallSeconds(type) * 1000
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
