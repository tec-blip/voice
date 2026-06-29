import { describe, it, expect } from 'vitest'
import { evaluateQuota, type BucketState } from './quota'

const policy = { capacity: 3, windowMs: 3000 } // 1 token/seg

describe('evaluateQuota', () => {
  it('un bucket nuevo permite hasta capacity y luego agota', () => {
    let state: BucketState | undefined
    const now = 1_000_000
    for (let i = 0; i < 3; i++) {
      const d = evaluateQuota(state, policy, now)
      expect(d.ok).toBe(true)
      state = d.nextState
    }
    const denied = evaluateQuota(state, policy, now)
    expect(denied.ok).toBe(false)
    expect(denied.retryAfterSec).toBeGreaterThanOrEqual(1)
  })

  it('refill tras el tiempo permite de nuevo', () => {
    const now = 2_000_000
    // agotar
    let d = evaluateQuota({ tokens: 0, lastRefill: now }, policy, now)
    expect(d.ok).toBe(false)
    // 1 segundo después → ~1 token
    d = evaluateQuota({ tokens: 0, lastRefill: now }, policy, now + 1000)
    expect(d.ok).toBe(true)
  })

  it('es determinista con un now explícito', () => {
    const s = { tokens: 1, lastRefill: 500 }
    const a = evaluateQuota(s, policy, 500)
    const b = evaluateQuota(s, policy, 500)
    expect(a).toEqual(b)
  })

  it('no supera capacity tras un refill largo', () => {
    const d = evaluateQuota({ tokens: 0, lastRefill: 0 }, policy, 9_999_999)
    expect(d.nextState.tokens).toBeLessThanOrEqual(policy.capacity)
  })
})
