-- Migration 005: Fase 0 de seguridad (crítica).
-- Cierra tres agujeros verificados en producción:
--   1) Escalada a admin: la policy UPDATE de users no tenía WITH CHECK → un
--      usuario podía cambiar su propia columna `role` a 'admin'.
--   2) Falsificación de score: misma falla en sessions → editar el propio score.
--   3) Las RPC de control de costo eran ejecutables por PUBLIC/anon/authenticated
--      (default de Postgres) → un usuario podía agotar/manipular cuota ajena.

-- ── 1) users: solo name/avatar de la propia fila; nunca role/email ──────────
-- El cambio de rol vive en admin_update_user_role (SECURITY DEFINER + is_admin()).
revoke update on public.users from anon, authenticated;
grant update (name, avatar_url) on public.users to authenticated;

drop policy if exists "Users can update own profile" on public.users;
create policy "Users can update own profile"
  on public.users for update
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ── 2) sessions: registros inmutables desde el cliente ──────────────────────
-- Se crean por INSERT (policy propia intacta) y no deben editarse.
drop policy if exists "Users can update own sessions" on public.sessions;
revoke update on public.sessions from anon, authenticated;

-- ── 3) RPC de control de costo: solo service_role (invocadas server-side) ────
revoke execute on function public.start_session(uuid, integer, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.end_session(uuid, integer)                              from public, anon, authenticated;
revoke execute on function public.heartbeat_session(uuid)                                 from public, anon, authenticated;
revoke execute on function public.reap_stale_sessions(integer)                            from public, anon, authenticated;
revoke execute on function public.consume_token(text, integer, bigint)                    from public, anon, authenticated;
