-- Migration 002: get_user_names RPC + índices de leaderboard
-- Aplicar en Supabase SQL Editor (o vía `supabase db push` cuando se adopte CLI).
--
-- WHAT THIS DOES:
--   1. get_user_names() — RPC SECURITY DEFINER que el leaderboard (/api/rankings)
--      ya invoca pero que NO existía → los nombres degradaban a "Usuario".
--      Expone SOLO id + name (no email) bypassando la RLS de `users` (que solo
--      permite leer la fila propia).
--   2. Índices parciales para que el leaderboard y el recálculo de rank escalen.

-- 1) get_user_names: resuelve nombres para un conjunto de user_ids
create or replace function public.get_user_names(p_ids uuid[])
returns table (id uuid, name text)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select u.id, u.name
  from public.users u
  where u.id = any(p_ids)
$$;

grant execute on function public.get_user_names(uuid[]) to anon, authenticated;

-- 2) Índices de rankings (el leaderboard filtra sessions_count>0 y ordena por rank;
--    recalculate_rankings ordena por avg_score/total_score/updated_at).
create index if not exists idx_rankings_active
  on public.rankings (rank)
  where sessions_count > 0;

create index if not exists idx_rankings_leaderboard
  on public.rankings (avg_score desc, total_score desc, updated_at asc)
  where sessions_count > 0;
