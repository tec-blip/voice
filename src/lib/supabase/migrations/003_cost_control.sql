-- Migration 003: Control de costo de IA (ledger atómico + concurrencia) y
-- rate limiting distribuido en Postgres.
--
-- Aplicar en Supabase SQL Editor (o `supabase db push`).
--
-- WHAT THIS DOES:
--   1. active_sessions  — sesiones de voz "en vuelo" (con heartbeat).
--   2. daily_quota      — ledger atómico de segundos consumidos + reservados por día.
--   3. start_session / end_session / heartbeat_session / reap_stale_sessions
--      — RPCs SECURITY DEFINER que tapan el hueco de la cuota actual (que solo
--        contaba sesiones YA terminadas y no limitaba concurrencia).
--   4. rate_limits + consume_token — token bucket distribuido (reemplazo del
--      rate limiter in-memory que cada lambda tenía por separado).
--
-- Estos RPC se invocan SOLO desde rutas server con el cliente service-role
-- (src/lib/supabase/admin.ts). Por eso se otorga execute a service_role, no a
-- authenticated: el cliente no debe poder saltarse el control de costo.

-- ───────────────────────────── Tablas ──────────────────────────────────────

create table if not exists public.active_sessions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users on delete cascade,
  started_at        timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  estimated_seconds integer not null default 0,
  reserved_seconds  integer not null default 0,
  status            text not null default 'active' check (status in ('active', 'closed'))
);
create index if not exists idx_active_sessions_user_status
  on public.active_sessions (user_id, status);

create table if not exists public.daily_quota (
  user_id          uuid not null references public.users on delete cascade,
  quota_date       date not null,
  consumed_seconds integer not null default 0,
  reserved_seconds integer not null default 0,
  primary key (user_id, quota_date)
);

create table if not exists public.rate_limits (
  key         text primary key,
  tokens      double precision not null,
  last_refill bigint not null   -- epoch ms
);

alter table public.active_sessions enable row level security;
alter table public.daily_quota     enable row level security;
alter table public.rate_limits     enable row level security;
-- Sin policies de acceso: solo el service-role (que bypassa RLS) las toca.

-- ──────────────────────── Reaping de sesiones huérfanas ─────────────────────
-- El sessionHandle de Gemini Live vive solo en memoria del cliente; si el
-- navegador crashea, la sesión activa queda colgada reteniendo su reserva.
create or replace function public.reap_stale_sessions(p_stale_seconds int default 90)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    select id, user_id, reserved_seconds, started_at
    from public.active_sessions
    where status = 'active'
      and last_heartbeat_at < now() - make_interval(secs => p_stale_seconds)
    for update skip locked
  loop
    update public.active_sessions
       set status = 'closed',
           estimated_seconds = greatest(estimated_seconds, floor(extract(epoch from (now() - r.started_at)))::int)
     where id = r.id;

    update public.daily_quota
       set reserved_seconds = greatest(0, reserved_seconds - r.reserved_seconds)
     where user_id = r.user_id and quota_date = (r.started_at at time zone 'utc')::date;

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ───────────────────────────── start_session ───────────────────────────────
-- Atómico: reap → check concurrencia → check cuota → inserta sesión + reserva.
create or replace function public.start_session(
  p_user_id            uuid,
  p_max_concurrent     int default 1,
  p_daily_limit_seconds int default 3600,
  p_reserve_seconds    int default 600,
  p_stale_seconds      int default 90
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today    date := (now() at time zone 'utc')::date;
  v_active   int;
  v_consumed int;
  v_reserved int;
  v_session_id uuid;
begin
  perform public.reap_stale_sessions(p_stale_seconds);

  select count(*) into v_active
  from public.active_sessions
  where user_id = p_user_id and status = 'active';

  if v_active >= p_max_concurrent then
    raise exception 'concurrent_limit' using errcode = 'P0001';
  end if;

  insert into public.daily_quota (user_id, quota_date)
  values (p_user_id, v_today)
  on conflict (user_id, quota_date) do nothing;

  select consumed_seconds, reserved_seconds into v_consumed, v_reserved
  from public.daily_quota
  where user_id = p_user_id and quota_date = v_today
  for update;

  if v_consumed + v_reserved >= p_daily_limit_seconds then
    raise exception 'daily_limit' using errcode = 'P0001';
  end if;

  insert into public.active_sessions (user_id, reserved_seconds, status)
  values (p_user_id, p_reserve_seconds, 'active')
  returning id into v_session_id;

  update public.daily_quota
     set reserved_seconds = reserved_seconds + p_reserve_seconds
   where user_id = p_user_id and quota_date = v_today;

  return v_session_id;
end;
$$;

-- ───────────────────────────── heartbeat_session ───────────────────────────
create or replace function public.heartbeat_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.active_sessions
     set last_heartbeat_at = now()
   where id = p_session_id and status = 'active';
end;
$$;

-- ───────────────────────────── end_session ─────────────────────────────────
-- Concilia la reserva con el consumo real al cerrar la llamada.
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
begin
  select user_id, reserved_seconds, started_at
    into v_user_id, v_reserved, v_started
  from public.active_sessions
  where id = p_session_id and status = 'active'
  for update;

  if v_user_id is null then
    return; -- ya cerrada o inexistente (idempotente)
  end if;

  update public.active_sessions
     set status = 'closed',
         estimated_seconds = greatest(0, p_actual_seconds)
   where id = p_session_id;

  update public.daily_quota
     set reserved_seconds = greatest(0, reserved_seconds - v_reserved),
         consumed_seconds = consumed_seconds + greatest(0, p_actual_seconds)
   where user_id = v_user_id and quota_date = (v_started at time zone 'utc')::date;
end;
$$;

-- ───────────────────────────── consume_token ───────────────────────────────
-- Token bucket atómico (mismo modelo que engine/quota, pero compartido entre
-- instancias). Devuelve si pasa, el retry y los tokens restantes.
create or replace function public.consume_token(p_key text, p_capacity int, p_window_ms bigint)
returns table (ok boolean, retry_after_sec int, remaining int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now    bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_refill double precision := p_capacity::double precision / p_window_ms; -- tokens/ms
  v_tokens double precision;
  v_last   bigint;
begin
  insert into public.rate_limits (key, tokens, last_refill)
  values (p_key, p_capacity, v_now)
  on conflict (key) do nothing;

  select tokens, last_refill into v_tokens, v_last
  from public.rate_limits where key = p_key for update;

  v_tokens := least(p_capacity, v_tokens + (v_now - v_last) * v_refill);

  if v_tokens < 1 then
    update public.rate_limits set tokens = v_tokens, last_refill = v_now where key = p_key;
    return query select false, greatest(1, ceil((1 - v_tokens) / v_refill / 1000.0))::int, 0;
    return;
  end if;

  v_tokens := v_tokens - 1;
  update public.rate_limits set tokens = v_tokens, last_refill = v_now where key = p_key;
  return query select true, 0, floor(v_tokens)::int;
end;
$$;

-- ───────────────────────────── Grants ──────────────────────────────────────
-- Solo service_role: estas funciones se invocan desde rutas server con el
-- cliente admin, nunca directamente desde el navegador.
grant execute on function public.reap_stale_sessions(int)                to service_role;
grant execute on function public.start_session(uuid, int, int, int, int) to service_role;
grant execute on function public.heartbeat_session(uuid)                 to service_role;
grant execute on function public.end_session(uuid, int)                  to service_role;
grant execute on function public.consume_token(text, int, bigint)        to service_role;
