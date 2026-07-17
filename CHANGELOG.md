# Changelog

Todos los cambios notables de SalesVoice. Formato basado en
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); fechas en `AAAA-MM-DD`.

Categorías: **Added** (nuevo) · **Changed** (cambio de comportamiento) ·
**Fixed** (arreglo) · **Security** (seguridad) · **Removed** (eliminado).

> Mantenimiento: al hacer un cambio relevante, añade una entrada bajo la fecha del día.
> El detalle de arquitectura vive en [CLAUDE.md](./CLAUDE.md) y [DEVELOPER.md](./DEVELOPER.md).

---

## 2026-07-06

### Fixed
- **Reversión de rol del prospecto** (`159a7de`): la IA se identificaba como "Luis Romero
  de la academia de trading" (rol de vendedor). Reforzado `ROLE_LOCK` en
  `src/lib/prompts/roleplay.ts` con reglas de identidad (el prospecto es un particular,
  usa su propio nombre, nunca el de la empresa/academia; prohibidas frases de
  recepcionista como "¿en qué puedo ayudarte?").
- **Sensación de "llamada en frío"** en modo `general` (`159a7de`): añadido contexto
  "YA AGENDASTE" — el prospecto sabe que agendó y esperaba la llamada, no actúa como spam.

### Changed
- **Catálogo de escenarios: 30 → 1011** (`631bd26`). Se destapó un cap hardcodeado
  (`if len(picked) >= 30` en `build_scenario_briefs`, `scripts/aggregate-roleplay-assets.py`)
  que descartaba ~980 casos reales usables. `profiles.jsonl` (1036 perfiles) estaba intacto.
- Añadido `estado_inicial.nombre` (nombre ficticio determinista por género) a cada
  escenario, para que el prospecto tenga identidad propia del caso (nunca el nombre real
  del cliente = PII). Interfaces `ScenarioBrief` actualizadas (`route.ts` + `roleplay.ts`).

### Added
- `scripts/build-scenarios.mjs`: regenerador offline (Node, sin LLM) de
  `src/data/scenarios.json` a partir de `profiles.jsonl`, sin cap y con filtro de calidad
  (dolor + ≥1 objeción + ≥1 frase + ≥250 palabras). Cap del script Python ahora
  configurable (`limit`/`per_arch`, default sin cap).

## 2026-07-05

### Fixed
- **Cierre prematuro sobre "soft-yes"** (`e362b03`): la IA daba la venta por cerrada al
  primer "sí" y colgaba a mitad del pitch (reportado con datos de Ivan/Jose). Cuatro frentes:
  - Motor: `canModelUseReason()` en `engine/call-lifecycle` — en arco completo
    (`general`/`cierre`/`llamada_fria`/`framing`) el modelo NO puede autocerrar como
    `cierre_exitoso` (solo finales negativos/neutros); el drill de `objeciones` sí.
  - Hook `use-gemini-live.ts`: cablea el gate de `reason` con re-engage específico
    (`REENGAGE_CLOSE_PROMPT`) que empuja al prospecto a exigir el pitch.
  - Prompt `roleplay.ts`: "decir sí NO es colgar"; el vendedor presenta y cierra.
  - Evaluación `evaluation.ts`: valora el arco completo (4 fases), penaliza fase saltada.
- **`go_away` forzaba el cierre** (`e362b03`): reconexión PROACTIVA ~3s antes del límite de
  sesión de Gemini (`goAwayTimerRef` en `use-gemini-live.ts`), usando el handle de
  resumption, para cruzar el límite de ~10 min sin corte y que el modelo no use el fin de
  sesión como señal para colgar.

## 2026-07-03

### Fixed
- **Bug raíz de reconexión / "error con Gemini"** (`de484ce`): el setup del WebSocket solo
  enviaba `sessionResumption` al reconectar. Gemini Live exige `sessionResumption: {}` en el
  setup INICIAL como opt-in para emitir handles. Sin él, no había reconexión ni "Reanudar"
  y las llamadas largas cortaban con error. Fix: enviar siempre el campo.

### Added / Fixed — Producto Fase 3 parte 2 (`8f7b456`)
- **Badges persistentes** vía RPC `sync_user_badges` (SECURITY DEFINER, migración 007);
  `badge-logic.ts` ya no depende del UPDATE bloqueado por RLS. Backfill 16/16 usuarios.
- Historial paginado (`/api/sessions/list?limit&offset` + "Cargar más").
- Marcador "Evaluación provisional" (heurístico) en historial.
- `forgot-password` usa `window.location.origin` (quitado dominio hardcodeado).

## 2026-07-02

### Security — Fase 0 (`84f86a4`, migración 005)
- Cerrada **escalada a admin**: la policy UPDATE de `users` no tenía `WITH CHECK` →
  cualquiera podía `set role='admin'`. Ahora column-grant (name/avatar) + WITH CHECK.
- Cerrada **falsificación de score**: policy UPDATE de `sessions` eliminada + revoke.
- RPC de costo (`start/end/heartbeat/reap/consume_token`) revocadas de PUBLIC → solo `service_role`.

### Fixed — Fase 1 estabilidad de voz (`f46d2d8`)
- **Half-duplex/mute nunca se activó** (closure congelado en `use-microphone.ts`): el eco del
  modelo se reenviaba a Gemini → transcripción basura. Fix: `onAudioData` vía ref.
- Interrupt de despedida ya no pierde el `end_call` (la IA no queda muda).
- `onError` libera mic/WS/reserva (evita bloqueo "ya tienes llamada activa").
- `finalizeCall` idempotente (sin doble guardado); heartbeat también en estado `dropped`.

### Security / Integrity — Fase 2 (`6f86cf4`, migración 006)
- `/api/sessions` recalcula el score **server-side** (ignora el del cliente) + rate-limit 20/h.
- `end_session` mide la duración en el servidor (evita `actualSeconds=0` que evadía la cuota).

### Fixed — Producto Fase 3 parte 1 (`22012ed`)
- Color del score corregido en 6 archivos (60-79 ya no es rojo; escala monótona).
- Umbral mínimo: llamadas <2 turnos del vendedor no se evalúan ni guardan.
- Guardado verifica `res.ok` y avisa. `/api/evaluate` recibe tipo+duración e inyecta contexto.

## 2026-06-30

### Added
- **Registro de eventos de llamada + Reanudar** (`596bd2c`, migración 004): columna
  `sessions.events` (jsonb); el hook registra ciclo de vida (connect, go_away, reconnect,
  end_call, ws_close, etc.). Botón "Reanudar" cuando la reconexión se agota pero hay handle.

### Fixed
- **Candado de rol** (`6d08119`): la IA tomaba el rol de vendedora. Añadido `ROLE_LOCK`
  (fuente única) en las 3 bases de prompt.
- Transcripciones vacías en historial y panel admin (`74808d9`): `content ?? text`.

## 2026-06-29

### Added
- **Motor determinista + control de costo + estabilidad** (`4eb17c5`): capa `src/lib/engine/`
  (scoring, call-lifecycle, transcript, quota, heurístico), tests Vitest, ledger de cuota
  (`active_sessions`/`daily_quota`), rate-limit en Postgres, metering de costo.

### Fixed
- **La IA se quedaba muda** al bloquear su `end_call` (`862e408`): pisos por tipo bajados y
  re-enganche vía `clientContent` para que nunca quede dead-air.

## 2026-06-12

### Added
- Flujo de recuperación de contraseña (forgot/reset) (`4314b2b`, `65b7a6b`).

## 2026-05-12 – 2026-05-19

### Added
- `DEVELOPER.md`: guía técnica completa (`d55458c`).

### Fixed
- Normalizar transcript antes de guardar (`5b35d73`).

## 2026-04-29

### Added
- Branding Sales Voice: logo, paleta roja, animación de ondas en login (`08264a2`, `c3447c3`, `036dad5`).
- Rate limiting, validación de input estricta, lógica de badges (`dcc547d`).

### Fixed
- Barge-in ya no corta la llamada (`6260937`).

## 2026-04-28

### Added
- Selección de voz por género (`a893d80`); modo objeciones como drill puro (`d53aada`).
- Escenarios reales de clientes por nicho (`c29b490`); Sentry + banner de privacidad + cron
  nocturno de ranking (`fd8f184`); PWA icon, error boundary, paginación (`7d21ca2`).

### Fixed
- **Cortes en móvil**: Wake Lock + recuperación por `visibilitychange` (`abef3f2`).
- Null guards en `buildScenarioPrompt` + regenerar scenarios.json (`d0c8a11`).

### Security
- Endurecimiento: auth guards, límites de input, fix de open redirect (`bedf812`).

## 2026-04-27

### Fixed
- **Corte a los 2 min**: refresco del access token en la reconexión (`9ac4b2d`).
- Roleplays funcionan en móvil (iOS Safari + Android) (`77e6054`).
- OIDC token vía `@vercel/functions/oidc` (`777ea8a`).

## 2026-04-22 – 2026-04-25

### Added
- **Migración a Vertex AI Live API** para la voz (`f37a959`); Workload Identity Federation
  para auth en producción (`b50bb2d`).
- Metodología Luis Romero + evaluador Gemini (`bf9a9bb`); panel de admin + roles +
  transcripciones en historial (`1f66aa3`, `4d91ec5`).
- Commit inicial — app de roleplay de ventas por voz (`55f59f7`).

### Fixed
- Nombres reales en ranking + session resumption para llamadas largas (`6d31d82`).
