/**
 * Rate limiter en memoria — token bucket por (key) con refill suave.
 *
 * IMPORTANTE: vive en la memoria del proceso (lambda warm). No es estrictamente
 * distribuido — si Vercel escala a varias instancias, cada una tiene su propio
 * bucket. Esto es suficiente para parar click-spam y bucles accidentales.
 *
 * Para una garantía dura entre instancias, migrar a Upstash Redis con la misma
 * interfaz `enforceRateLimit(key, opts)`.
 */

import { NextResponse } from 'next/server'

type Bucket = { tokens: number; lastRefill: number }

const buckets = new Map<string, Bucket>()

// Limpieza periódica para evitar fuga de memoria con muchos usuarios distintos.
// Solo aplica si el módulo lleva vivo > 10 min (Lambda warm puede durar horas).
let lastCleanup = Date.now()
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000
const STALE_BUCKET_MS = 30 * 60 * 1000

function maybeCleanup(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  for (const [key, b] of buckets) {
    if (now - b.lastRefill > STALE_BUCKET_MS) buckets.delete(key)
  }
  lastCleanup = now
}

export interface RateLimitOptions {
  /** Cuántas peticiones se permiten en `windowMs`. */
  capacity: number
  /** Ventana de refill completo. */
  windowMs: number
}

export interface RateLimitResult {
  ok: boolean
  retryAfterSec: number
  remaining: number
}

export function checkRateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now()
  maybeCleanup(now)

  const refillRate = opts.capacity / opts.windowMs // tokens/ms
  let b = buckets.get(key)
  if (!b) {
    b = { tokens: opts.capacity, lastRefill: now }
    buckets.set(key, b)
  } else {
    const elapsed = now - b.lastRefill
    b.tokens = Math.min(opts.capacity, b.tokens + elapsed * refillRate)
    b.lastRefill = now
  }

  if (b.tokens < 1) {
    const retryAfterMs = Math.ceil((1 - b.tokens) / refillRate)
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      remaining: 0,
    }
  }

  b.tokens -= 1
  return {
    ok: true,
    retryAfterSec: 0,
    remaining: Math.floor(b.tokens),
  }
}

/**
 * Helper que devuelve un NextResponse 429 si la clave excede el límite,
 * o null si puede continuar. Uso típico:
 *
 *   const limited = enforceRateLimit(`evaluate:${user.id}`, { capacity: 10, windowMs: 3600_000 })
 *   if (limited) return limited
 */
export function enforceRateLimit(key: string, opts: RateLimitOptions) {
  const result = checkRateLimit(key, opts)
  if (result.ok) return null
  return NextResponse.json(
    {
      error: `Demasiadas peticiones. Intenta de nuevo en ${result.retryAfterSec}s.`,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfterSec: result.retryAfterSec,
    },
    {
      status: 429,
      headers: { 'Retry-After': String(result.retryAfterSec) },
    },
  )
}
