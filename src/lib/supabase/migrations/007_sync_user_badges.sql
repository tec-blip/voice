-- Migration 007: sync_user_badges — arregla que los badges no se persistan.
--
-- El write de badges vivía en badge-logic.ts con el cliente del usuario, pero
-- `rankings` no tiene policy de UPDATE → RLS lo bloqueaba en silencio. Esta RPC
-- SECURITY DEFINER computa los badges (calculate_badges, sobre las sesiones
-- reales → no falsificable), los UNE con los ya ganados (nunca se quitan) y los
-- escribe. Devuelve el set final.

create or replace function public.sync_user_badges(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fresh    jsonb;
  v_existing jsonb;
  v_merged   jsonb;
begin
  v_fresh := public.calculate_badges(p_user_id);

  select coalesce(badges, '[]'::jsonb) into v_existing
  from public.rankings where user_id = p_user_id;

  -- Unión sin duplicados (los badges no se pierden una vez ganados).
  select to_jsonb(array(
    select distinct e
    from (
      select jsonb_array_elements_text(coalesce(v_existing, '[]'::jsonb)) as e
      union
      select jsonb_array_elements_text(coalesce(v_fresh, '[]'::jsonb)) as e
    ) u
    order by e
  )) into v_merged;

  update public.rankings set badges = v_merged where user_id = p_user_id;
  return v_merged;
end;
$$;

revoke execute on function public.sync_user_badges(uuid) from public, anon;
grant execute on function public.sync_user_badges(uuid) to authenticated, service_role;
