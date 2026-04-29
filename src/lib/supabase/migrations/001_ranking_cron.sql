-- Migration 001: Lighter ranking trigger + cron-ready recalculate function
-- Run this in Supabase SQL Editor to apply.
--
-- WHAT THIS DOES:
--   1. update_user_stats()  — solo actualiza stats del usuario que insertó sesión.
--                             NO recalcula el rank global. Esto hace el trigger rápido.
--   2. recalculate_rankings() — recalcula el rank global de todos los usuarios.
--                              Se llama desde el cron job nocturno (/api/cron/rankings).
--   3. sessions_refresh_ranking() — trigger actualizado para llamar a update_user_stats.

-- Paso 1: función ligera para el trigger (solo stats del usuario)
create or replace function public.update_user_stats(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
  v_avg   numeric(5,2);
  v_total int;
begin
  select count(*)::int,
         coalesce(round(avg(score)::numeric, 2), 0),
         coalesce(sum(score)::int, 0)
    into v_count, v_avg, v_total
  from public.sessions
  where user_id = p_user_id and score is not null;

  insert into public.rankings (user_id, total_score, avg_score, sessions_count, updated_at, badges)
  values (p_user_id, v_total, v_avg, v_count, now(), '[]'::jsonb)
  on conflict (user_id) do update set
    total_score    = excluded.total_score,
    avg_score      = excluded.avg_score,
    sessions_count = excluded.sessions_count,
    updated_at     = now();
end;
$$;

-- Paso 2: función para el cron (recalcula rank global)
create or replace function public.recalculate_rankings()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  with ranked as (
    select user_id,
           row_number() over (order by avg_score desc, total_score desc, updated_at asc) as new_rank
    from public.rankings
    where sessions_count > 0
  )
  update public.rankings r
     set rank = ranked.new_rank
    from ranked
   where r.user_id = ranked.user_id;

  update public.rankings
     set rank = 0
   where sessions_count = 0 and rank <> 0;
end;
$$;

-- Permitir que el endpoint cron (anon key, SECURITY DEFINER) ejecute la función
grant execute on function public.recalculate_rankings() to anon, authenticated;

-- Paso 3: trigger actualizado — llama a la función ligera
create or replace function public.sessions_refresh_ranking()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT' or tg_op = 'UPDATE') and new.user_id is not null then
    perform public.update_user_stats(new.user_id);
  elsif tg_op = 'DELETE' and old.user_id is not null then
    perform public.update_user_stats(old.user_id);
  end if;
  return coalesce(new, old);
end;
$$;
