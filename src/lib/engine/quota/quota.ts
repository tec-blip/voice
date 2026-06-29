// Matemática pura de cuota (token bucket con refill suave). Sin Map global, sin
// Date.now interno: el estado y el "ahora" se pasan como argumentos para que sea
// determinista y testeable. rate-limit.ts es el adaptador que mantiene el Map y
// el NextResponse y delega el cálculo aquí.

export interface BucketState {
  tokens: number
  lastRefill: number
}

export interface QuotaPolicy {
  /** Cuántas peticiones se permiten en `windowMs`. */
  capacity: number
  /** Ventana de refill completo en ms. */
  windowMs: number
}

export interface QuotaDecision {
  ok: boolean
  remaining: number
  retryAfterSec: number
  nextState: BucketState
}

/**
 * Decide si una petición pasa el rate limit dado el estado previo del bucket,
 * la política y el instante actual. Devuelve la decisión y el NUEVO estado
 * (el llamador lo persiste donde corresponda: Map en memoria, Postgres, etc.).
 */
export function evaluateQuota(
  state: BucketState | undefined,
  policy: QuotaPolicy,
  now: number,
): QuotaDecision {
  const refillRate = policy.capacity / policy.windowMs // tokens/ms

  let tokens: number
  if (!state) {
    tokens = policy.capacity
  } else {
    const elapsed = Math.max(0, now - state.lastRefill)
    tokens = Math.min(policy.capacity, state.tokens + elapsed * refillRate)
  }

  if (tokens < 1) {
    const retryAfterMs = Math.ceil((1 - tokens) / refillRate)
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      nextState: { tokens, lastRefill: now },
    }
  }

  tokens -= 1
  return {
    ok: true,
    remaining: Math.floor(tokens),
    retryAfterSec: 0,
    nextState: { tokens, lastRefill: now },
  }
}
