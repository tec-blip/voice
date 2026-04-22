-- SalesVoice Database Schema

create table public.users (
  id uuid references auth.users on delete cascade primary key,
  email text not null unique,
  name text not null,
  role text not null default 'alumno' check (role in ('alumno', 'instructor', 'admin')),
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users on delete cascade,
  type text not null check (type in ('cierre', 'llamada_fria', 'framing', 'general', 'objeciones')),
  scenario text,
  score integer check (score >= 0 and score <= 100),
  duration integer,
  transcript jsonb not null default '[]'::jsonb,
  feedback jsonb,
  created_at timestamptz not null default now()
);

create table public.knowledge_base (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  scenario_text text not null,
  difficulty text not null default 'intermedio' check (difficulty in ('basico', 'intermedio', 'avanzado')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.rankings (
  user_id uuid primary key references public.users on delete cascade,
  total_score integer not null default 0,
  avg_score numeric(5,2) not null default 0,
  sessions_count integer not null default 0,
  rank integer not null default 0,
  badges jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.methodology (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null,
  evaluation_criteria jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Indexes
create index idx_sessions_user_id on public.sessions(user_id);
create index idx_sessions_created_at on public.sessions(created_at desc);
create index idx_sessions_user_created on public.sessions(user_id, created_at desc);
create index idx_knowledge_base_category on public.knowledge_base(category);
create index idx_rankings_rank on public.rankings(rank);

-- Enable RLS
alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.knowledge_base enable row level security;
alter table public.rankings enable row level security;
alter table public.methodology enable row level security;

-- Helper functions (SECURITY DEFINER) para evitar recursión infinita en policies.
-- IMPORTANTE: una policy de una tabla NUNCA puede hacer SELECT directo sobre su
-- misma tabla (ni indirectamente) porque Postgres re-evaluaría la policy al querer
-- leer esa row, causando "infinite recursion detected in policy". Estas funciones
-- bypassan RLS porque corren con permisos del owner.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.users where id = auth.uid() and role = 'admin')
$$;

create or replace function public.is_instructor_or_admin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.users where id = auth.uid() and role in ('instructor', 'admin'))
$$;

-- Users policies
create policy "Users can read own profile"
  on public.users for select
  using (auth.uid() = id);

create policy "Admins can read all users"
  on public.users for select
  using (public.is_admin());

create policy "Users can update own profile"
  on public.users for update
  using (auth.uid() = id);

create policy "Enable insert for auth trigger"
  on public.users for insert
  with check (auth.uid() = id);

-- Sessions policies
create policy "Users can read own sessions"
  on public.sessions for select
  using (auth.uid() = user_id);

create policy "Instructors can read all sessions"
  on public.sessions for select
  using (public.is_instructor_or_admin());

create policy "Users can insert own sessions"
  on public.sessions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own sessions"
  on public.sessions for update
  using (auth.uid() = user_id);

-- Knowledge base policies
create policy "Everyone can read knowledge base"
  on public.knowledge_base for select
  using (true);

create policy "Admins can manage knowledge base"
  on public.knowledge_base for all
  using (public.is_admin());

-- Rankings policies
create policy "Everyone can read rankings"
  on public.rankings for select
  using (true);

-- Methodology policies
create policy "Everyone can read methodology"
  on public.methodology for select
  using (true);

create policy "Admins can manage methodology"
  on public.methodology for all
  using (public.is_admin());

-- Auto-create user profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    'alumno'
  );
  insert into public.rankings (user_id)
  values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Recalcular ranking de un usuario (sessions_count, avg_score, total_score, rank global)
-- badges se conservan; se actualizan desde otro flujo cuando se otorguen.
create or replace function public.update_ranking(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
  v_avg numeric(5,2);
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

-- Trigger: recalcular rankings automáticamente al insertar/actualizar/borrar sesiones.
-- Así el cliente no necesita llamar al RPC manualmente.
create or replace function public.sessions_refresh_ranking()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT' or tg_op = 'UPDATE') and new.user_id is not null then
    perform public.update_ranking(new.user_id);
  elsif tg_op = 'DELETE' and old.user_id is not null then
    perform public.update_ranking(old.user_id);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists sessions_refresh_ranking_trg on public.sessions;
create trigger sessions_refresh_ranking_trg
  after insert or update or delete on public.sessions
  for each row execute function public.sessions_refresh_ranking();
