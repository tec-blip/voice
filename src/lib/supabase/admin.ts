import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Cliente Supabase con SERVICE ROLE — SOLO para uso en rutas server.
 *
 * Bypassa RLS, así que NUNCA debe importarse desde código de cliente. Se usa para
 * invocar los RPC de control de costo (start_session, end_session, consume_token,
 * etc., ver migrations/003_cost_control.sql) que están otorgados solo a
 * `service_role` para que el navegador no pueda saltarse los límites.
 *
 * Sin tipar con <Database>: ese tipo (hand-written) no incluye las Functions ni
 * las tablas nuevas, y romperia los .rpc(). El cliente server de @supabase/ssr
 * tampoco está tipado, así que es consistente.
 *
 * Requiere la env var SUPABASE_SERVICE_ROLE_KEY (configurar en Vercel; NUNCA con
 * prefijo NEXT_PUBLIC_, no debe llegar al bundle del cliente).
 */
let cached: ReturnType<typeof createSupabaseClient> | null = null

/** True si el backend de control de costo está configurado. */
export function hasServiceRole(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL)
}

export function createAdminClient() {
  if (cached) return cached

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error(
      '[supabase/admin] Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY',
    )
  }

  cached = createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}

/**
 * Invoca un RPC con el cliente service-role. Centraliza el cast permisivo (el
 * cliente sin genérico Database tipa los args como `undefined` para funciones
 * que no conoce). Lanza si no hay service-role: los call-sites deben guardar con
 * hasServiceRole() y/o try-catch.
 */
export async function adminRpc<T = unknown>(
  fn: string,
  args?: Record<string, unknown>,
): Promise<{ data: T | null; error: { message: string } | null }> {
  const client = createAdminClient() as unknown as {
    rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>
  }
  return client.rpc(fn, args)
}
