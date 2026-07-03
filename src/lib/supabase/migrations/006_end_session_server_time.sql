-- Migration 006: end_session mide la duración en el SERVIDOR.
--
-- Antes sumaba `p_actual_seconds` (enviado por el cliente) a consumed_seconds →
-- un usuario podía cerrar cada llamada con actualSeconds=0 y no gastar cuota
-- nunca (bypass total del control de costo). Ahora la duración se calcula desde
-- active_sessions.started_at (server-authoritative), capada a 1h. El parámetro
-- p_actual_seconds se conserva por compatibilidad de firma pero se ignora para
-- la cuota. Solo service_role puede ejecutarla (ver 005).

create or replace function public.end_session(p_session_id uuid, p_actual_seconds int)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id  uuid;
  v_reserved int;
  v_started  timestamptz;
  v_wall     int;
begin
  select user_id, reserved_seconds, started_at
    into v_user_id, v_reserved, v_started
  from public.active_sessions
  where id = p_session_id and status = 'active'
  for update;

  if v_user_id is null then
    return; -- ya cerrada o inexistente (idempotente)
  end if;

  -- Duración real medida en el servidor (no se confía en el cliente). Capada a 1h.
  v_wall := least(3600, greatest(0, floor(extract(epoch from (now() - v_started)))::int));

  update public.active_sessions
     set status = 'closed',
         estimated_seconds = v_wall
   where id = p_session_id;

  update public.daily_quota
     set reserved_seconds = greatest(0, reserved_seconds - v_reserved),
         consumed_seconds = consumed_seconds + v_wall
   where user_id = v_user_id and quota_date = (v_started at time zone 'utc')::date;
end;
$$;

revoke execute on function public.end_session(uuid, integer) from public, anon, authenticated;
grant execute on function public.end_session(uuid, integer) to service_role;
