/**
 * Rate limiter con dos backends:
 *  - DISTRIBUIDO (Postgres RPC consume_token) cuando hay service-role — sobrevive
 *    a múltiples instancias Lambda.
 *  - EN MEMORIA (token bucket por proceso) como fallback si no hay service-role
 *    o si el RPC falla. Suficiente para parar click-spam y bucles.
 *
 * La interfaz `enforceRateLimit(key, opts)` es la misma; ahora es async.
 */

import { NextResponse } from 'next/server'
import { evaluateQuota, type BucketState } from '@/lib/engine'
import { adminRpc, hasServiceRole } from '@/lib/supabase/admin'

const buckets = new Map<string, BucketState>()

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

  // La matemática del token bucket vive en la capa-motor (engine/quota), pura y
  // testeable. Aquí solo persistimos el estado en el Map en memoria.
  const decision = evaluateQuota(buckets.get(key), { capacity: opts.capacity, windowMs: opts.windowMs }, now)
  buckets.set(key, decision.nextState)

  return {
    ok: decision.ok,
    retryAfterSec: decision.retryAfterSec,
    remaining: decision.remaining,
  }
}

/**
 * Backend distribuido (Postgres). Devuelve null si no está disponible
 * (sin service-role o error del RPC) → el llamador cae al bucket en memoria.
 */
async function checkRateLimitDistributed(key: string, opts: RateLimitOptions): Promise<RateLimitResult | null> {
  if (!hasServiceRole()) return null
  try {
    const { data, error } = await adminRpc<Array<{ ok: boolean; retry_after_sec: number; remaining: number }>>(
      'consume_token',
      { p_key: key, p_capacity: opts.capacity, p_window_ms: opts.windowMs },
    )
    const row = Array.isArray(data) ? data[0] : data
    if (error || !row) return null
    return {
      ok: Boolean(row.ok),
      retryAfterSec: Number(row.retry_after_sec ?? 0),
      remaining: Number(row.remaining ?? 0),
    }
  } catch {
    return null
  }
}

/**
 * Helper que devuelve un NextResponse 429 si la clave excede el límite,
 * o null si puede continuar. Async: intenta el backend distribuido y, si no está
 * disponible, usa el token bucket en memoria. Uso típico:
 *
 *   const limited = await enforceRateLimit(`evaluate:${user.id}`, { capacity: 10, windowMs: 3600_000 })
 *   if (limited) return limited
 */
export async function enforceRateLimit(key: string, opts: RateLimitOptions) {
  const result = (await checkRateLimitDistributed(key, opts)) ?? checkRateLimit(key, opts)
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
