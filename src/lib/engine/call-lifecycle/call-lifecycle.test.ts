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

  it('aplica el piso mínimo por tipo (backstop anti-corte-temprano)', () => {
    // general: 90s
    expect(canModelEndCall(89_000, 'general')).toBe(false)
    expect(canModelEndCall(90_000, 'general')).toBe(true)
    // objeciones: 30s
    expect(canModelEndCall(29_000, 'objeciones')).toBe(false)
    expect(canModelEndCall(30_000, 'objeciones')).toBe(true)
  })

  it('pasado el piso, NO filtra por reason (no congela: el prompt decide)', () => {
    // a 5 min cualquier cierre es válido para el guard (el modelo decide vía prompt)
    expect(canModelEndCall(300_000, 'general')).toBe(true)
    expect(canModelEndCall(300_000, 'cierre')).toBe(true)
  })
})

describe('minEndCallSeconds', () => {
  it('devuelve el piso por tipo y 30 por defecto', () => {
    expect(minEndCallSeconds()).toBe(30)
    expect(minEndCallSeconds('general')).toBe(90)
    expect(minEndCallSeconds('objeciones')).toBe(30)
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
