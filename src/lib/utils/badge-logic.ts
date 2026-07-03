/**
 * Otorga badges tras guardar una sesión.
 *
 * El cálculo Y el guardado viven en la RPC `sync_user_badges` (SECURITY DEFINER,
 * migración 007): computa los badges desde las sesiones reales del usuario (no
 * falsificable), los une con los ya ganados (nunca se quitan) y los persiste en
 * `rankings.badges`. Antes esto se hacía en TS con un UPDATE del cliente que la
 * RLS de `rankings` bloqueaba en silencio → los badges nunca se guardaban.
 */

import type { createClient } from '@/lib/supabase/server'
import type { TranscriptEntry } from '@/lib/types/database'

// El cliente de servidor no está parametrizado con `Database`.
type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export async function evaluateBadges(
  userId: string,
  supabase: SupabaseServerClient,
): Promise<string[]> {
  const { data, error } = await supabase.rpc('sync_user_badges', { p_user_id: userId })
  if (error) {
    console.warn('[badges] sync_user_badges failed', error.message)
    return []
  }
  return Array.isArray(data) ? (data as string[]) : []
}

// Re-exportado para que sessions/route.ts pueda tipar transcript sin importar
// el tipo desde dos sitios distintos.
export type { TranscriptEntry }
