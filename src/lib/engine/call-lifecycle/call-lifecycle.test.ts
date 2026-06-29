import { describe, it, expect } from 'vitest'
import {
  canModelEndCall,
  minEndCallSeconds,
  isHardCapReached,
  isWarningWindow,
  minutesRemaining,
  resolveEndReason,
} from './call-lifecycle'
import { MAX_CALL_SECONDS, WARN_CALL_SECONDS } from './limits'

describe('canModelEndCall', () => {
  it('sin tipo: guard global de 30s', () => {
    expect(canModelEndCall(29_999)).toBe(false)
    expect(canModelEndCall(30_000)).toBe(true)
    expect(canModelEndCall(Infinity)).toBe(true)
  })

  it('aplica el piso mínimo por tipo', () => {
    // general: 210s
    expect(canModelEndCall(200_000, { type: 'general', reason: 'cierre_exitoso' })).toBe(false)
    expect(canModelEndCall(210_000, { type: 'general', reason: 'cierre_exitoso' })).toBe(true)
    // objeciones: 45s
    expect(canModelEndCall(44_000, { type: 'objeciones', reason: 'cierre_exitoso' })).toBe(false)
    expect(canModelEndCall(45_000, { type: 'objeciones', reason: 'cierre_exitoso' })).toBe(true)
  })

  it('en arco completo solo permite cierre_exitoso (otros reasons los decide el usuario)', () => {
    // pasado el piso, pero reason no permitido en general
    expect(canModelEndCall(300_000, { type: 'general', reason: 'sin_interes' })).toBe(false)
    expect(canModelEndCall(300_000, { type: 'general', reason: 'timeout' })).toBe(false)
    expect(canModelEndCall(300_000, { type: 'general', reason: 'cierre_exitoso' })).toBe(true)
  })

  it('objeciones permite todos los reasons una vez pasado el piso', () => {
    expect(canModelEndCall(60_000, { type: 'objeciones', reason: 'objeciones_no_resueltas' })).toBe(true)
    expect(canModelEndCall(60_000, { type: 'objeciones', reason: 'sin_interes' })).toBe(true)
  })

  it('llamada_fria permite el rechazo realista (sin_interes)', () => {
    expect(canModelEndCall(80_000, { type: 'llamada_fria', reason: 'sin_interes' })).toBe(true)
    expect(canModelEndCall(80_000, { type: 'llamada_fria', reason: 'timeout' })).toBe(false)
  })
})

describe('minEndCallSeconds', () => {
  it('devuelve el piso por tipo y 30 por defecto', () => {
    expect(minEndCallSeconds()).toBe(30)
    expect(minEndCallSeconds('general')).toBe(210)
    expect(minEndCallSeconds('objeciones')).toBe(45)
  })
})

describe('isHardCapReached', () => {
  it('frontera del cap de 45 min', () => {
    expect(isHardCapReached(MAX_CALL_SECONDS - 1)).toBe(false)
    expect(isHardCapReached(MAX_CALL_SECONDS)).toBe(true)
    expect(isHardCapReached(MAX_CALL_SECONDS + 1)).toBe(true)
  })
})

describe('isWarningWindow', () => {
  it('activa entre WARN y MAX, no fuera', () => {
    expect(isWarningWindow(WARN_CALL_SECONDS - 1)).toBe(false)
    expect(isWarningWindow(WARN_CALL_SECONDS)).toBe(true)
    expect(isWarningWindow(MAX_CALL_SECONDS)).toBe(false)
  })
})

describe('minutesRemaining', () => {
  it('calcula minutos restantes, mínimo 0', () => {
    expect(minutesRemaining(WARN_CALL_SECONDS)).toBe(5)
    expect(minutesRemaining(MAX_CALL_SECONDS)).toBe(0)
    expect(minutesRemaining(MAX_CALL_SECONDS + 100)).toBe(0)
  })
})

describe('resolveEndReason', () => {
  it('colgado del usuario → manual', () => {
    expect(resolveEndReason({ endedBy: 'user', hardCapReached: false })).toBe('manual')
    expect(resolveEndReason({ endedBy: 'user', modelReason: 'cierre_exitoso', hardCapReached: false })).toBe('manual')
  })
  it('cap duro → timeout aunque el modelo diga otra cosa', () => {
    expect(resolveEndReason({ endedBy: 'model', modelReason: 'cierre_exitoso', hardCapReached: true })).toBe('timeout')
  })
  it('respeta un reason válido del modelo', () => {
    expect(resolveEndReason({ endedBy: 'model', modelReason: 'cierre_exitoso', hardCapReached: false })).toBe('cierre_exitoso')
  })
  it('reason inválido del modelo → fallback sin_interes', () => {
    expect(resolveEndReason({ endedBy: 'model', modelReason: 'lol', hardCapReached: false })).toBe('sin_interes')
    expect(resolveEndReason({ endedBy: 'model', hardCapReached: false })).toBe('sin_interes')
  })
})
