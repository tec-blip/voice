-- Migration 004: columna `events` en sessions para registro de ciclo de vida.
--
-- Guarda los eventos de la llamada (conexión, reconexiones, goAway, end_call,
-- interrupciones, cierre del WebSocket, quién terminó) para poder diagnosticar
-- cortes/silencios con datos en vez de deducir. Aditiva y opcional (nullable).

alter table public.sessions
  add column if not exists events jsonb;
