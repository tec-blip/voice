import { describe, it, expect } from 'vitest'
import {
  canModelEndCall,
  canModelUseReason,
  minEndCallSeconds,
  isHardCapReached,
  isWarningWindow,
  minutesRemaining,
  isMatureClose,
  resolveEndReason,
} from './call-lifecycle'
import { MAX_CALL_SECONDS, WARN_CALL_SECONDS, MATURE_CLOSE_SECONDS } from './limits'

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

describe('canModelUseReason', () => {
  it('arco completo: el modelo NO puede autocerrar como cierre_exitoso', () => {
    for (const t of ['general', 'cierre', 'llamada_fria', 'framing'] as const) {
      expect(canModelUseReason('cierre_exitoso', t)).toBe(false)
    }
  })

  it('drill de objeciones: SÍ permite cierre_exitoso', () => {
    expect(canModelUseReason('cierre_exitoso', 'objeciones')).toBe(true)
  })

  it('finales negativos/neutros permitidos en cualquier tipo', () => {
    for (const t of ['general', 'cierre', 'objeciones'] as const) {
      expect(canModelUseReason('sin_interes', t)).toBe(true)
      expect(canModelUseReason('objeciones_no_resueltas', t)).toBe(true)
      expect(canModelUseReason('timeout', t)).toBe(true)
    }
  })

  it("'manual' es del usuario, nunca del modelo", () => {
    expect(canModelUseReason('manual', 'general')).toBe(false)
    expect(canModelUseReason('manual', 'objeciones')).toBe(false)
  })

  it('reason desconocido → false', () => {
    expect(canModelUseReason('lol', 'general')).toBe(false)
    expect(canModelUseReason('', 'objeciones')).toBe(false)
  })

  it('sin tipo: cierre_exitoso bloqueado (conservador)', () => {
    expect(canModelUseReason('cierre_exitoso')).toBe(false)
    expect(canModelUseReason('sin_interes')).toBe(true)
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

describe('isMatureClose', () => {
  it('arco completo: solo maduro pasado el umbral', () => {
    const t = MATURE_CLOSE_SECONDS * 1000
    expect(isMatureClose(t - 1, 'general')).toBe(false)
    expect(isMatureClose(t, 'general')).toBe(true)
    expect(isMatureClose(t + 1, 'cierre')).toBe(true)
  })
  it('soft-yes prematuro (82s) NO es cierre maduro', () => {
    expect(isMatureClose(82_000, 'cierre')).toBe(false)
  })
  it('objeciones: nunca aplica el aviso híbrido', () => {
    expect(isMatureClose(Infinity, 'objeciones')).toBe(false)
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
