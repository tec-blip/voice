# SalesVoice — Contexto central del proyecto

> Documento vivo. Es el contexto que cualquier asistente IA (o dev) debe leer ANTES
> de tocar la app. Mantenlo actualizado al hacer cambios estructurales.
> Detalle técnico profundo: ver [DEVELOPER.md](./DEVELOPER.md).
> Última actualización: 2026-06-26.

## Qué es

App de entrenamiento de ventas **por voz**. El usuario practica llamadas hablando en
tiempo real con un prospecto IA; al colgar recibe una puntuación en 6 categorías
basada en la **Metodología Luis Romero (Closers Digitales)**. Producto de **Sales Hacking**.
UI 100% en español (es-MX), target LATAM.

**Flujo:** elige nicho + tipo de roleplay → se inyecta un escenario de cliente real
→ WebSocket de voz bidireccional (Gemini Live) → al colgar: transcripción → evaluación
→ resultados + guardado + badges.

## Stack

- **Next.js 16** App Router (TypeScript strict, Turbopack)
- **Supabase** (Auth + Postgres con RLS)
- **Voz:** Google **Gemini Live** sobre **Vertex AI** (WebSocket, token GCP vía Workload Identity Federation)
- **Evaluación:** **Gemini 2.5 Flash** (REST, JSON mode)
- **Tests:** Vitest · **Deploy:** Vercel (región `iad1`) · **Errores:** Sentry

## Principio arquitectónico rector ⭐

> **La lógica determinista vive en una capa-motor pura (`src/lib/engine/`) que funciona
> SIN LLM. La IA se usa SOLO donde es genuinamente necesaria.**

`src/lib/engine/` no importa `fetch`, Supabase, `process.env`, `next/*` ni React.
Es determinista, sincrónico y testeable sin red. Regla: *"¿se puede calcular con una
calculadora y reglas escritas?"* → sí = motor; necesita entender la conversación = IA.

- **IA (necesaria):** comportamiento conversacional del prospecto (Gemini Live) +
  evaluación cualitativa de las 6 categorías y los textos de feedback (Gemini Flash).
- **Motor (determinista):** cálculo de la puntuación general, validación/clamp de scores,
  límites del ciclo de llamada, normalización de transcript, matemática de cuota, y un
  **scorer heurístico de respaldo** que produce un score si la IA no está disponible.

## Estructura

```
src/
  app/
    api/
      evaluate/route.ts          # POST — Gemini Flash evalúa; el score general lo calcula el MOTOR
      vertex/config/route.ts     # GET — token GCP + URL WebSocket (solo emite token; sin cuota)
      sessions/route.ts          # POST — guarda sesión + evalúa badges
      sessions/start/route.ts    # POST — reserva sesión: enforce concurrencia + cuota (RPC atómico)
      sessions/heartbeat/route.ts# POST — mantiene viva la reserva durante la llamada
      sessions/end/route.ts      # POST — cierra reserva + concilia consumo + metering de costo
      sessions/list/route.ts     # GET  — historial del usuario
      rankings/route.ts          # GET  — leaderboard (usa RPC get_user_names)
      scenarios/route.ts         # GET  — escenario aleatorio (JSON estático, determinista)
      me/route.ts                # GET  — perfil
      admin/students/...         # admin: alumnos / detalle / rol
      cron/rankings/route.ts     # cron diario — recalcula rank global
      cron/reap/route.ts         # cron 15min — cierra sesiones de voz huérfanas
    dashboard/                   # page, practice, history, profile, ranking, onboarding, admin
    (login|register|...)
  components/  auth, dashboard (feedback-card, progress-chart), layout, phone (phone-ui), ui
  lib/
    engine/                      # ⭐ CAPA-MOTOR DETERMINISTA (ver abajo)
      scoring/   weights.ts, scoring.ts, heuristic.ts
      call-lifecycle/ limits.ts, call-lifecycle.ts
      transcript/ transcript.ts
      quota/     quota.ts
      types.ts, index.ts         # importa desde '@/lib/engine'
    hooks/       use-gemini-live, use-microphone, use-auth, use-user-role
    prompts/     roleplay.ts (5 tipos + buildScenarioPrompt), evaluation.ts (prompt + EvaluationResult)
    supabase/    client.ts, server.ts, admin.ts (service-role), middleware.ts, schema.sql, migrations/
    utils/       badge-logic.ts, badges.ts (deterministas, sin LLM — modelo a seguir)
    rate-limit.ts (distribuido Postgres + fallback en memoria), log.ts (logging/costo), env.ts
  data/scenarios.json            # 30 escenarios estáticos (trading + marca_personal_instagram)
```

## Capa-motor (`src/lib/engine/`)

- **scoring/** — `computeOverallScore` (promedio ponderado: descubrimiento×2, cierre×2,
  objeciones×1.5, resto×1, /8.5), `normalizeCategoryScores`/`clampScore` (saneo único),
  `getGradeLabel`/`getSkillLevel`. **El LLM ya NO calcula la puntuación general.**
- **scoring/heuristic.ts** — `estimateScoresHeuristic(transcript)`: score determinista de
  respaldo (cuenta turnos, preguntas, keywords por fase). Se usa si `/api/evaluate` falla;
  el resultado se marca `feedback_source:'heuristic'` y la UI muestra "evaluación provisional".
- **call-lifecycle/** — única fuente de verdad de los límites: `MAX_CALL_SECONDS` (45min),
  guardia mínima 30s, ventana de aviso. `canModelEndCall`, `isHardCapReached`, `resolveEndReason`.
  El prompt de roleplay ya NO menciona tiempos; el código los aplica.
- **transcript/** — `normalizeForStorage` (hook→DB) y `formatForEvaluation` (VENDEDOR/PROSPECTO).
- **quota/** — `evaluateQuota` (token bucket puro); `rate-limit.ts` lo usa como fallback.
- Tests: `src/**/*.test.ts` (Vitest). Correr `npm test`.

## Evaluación

`practice/page.tsx` → `/api/evaluate` (Gemini Flash devuelve las 6 categorías + 3 textos)
→ el **motor recalcula `puntuacion_general`**. Si la IA falla, `practice/page.tsx` cae al
**scorer heurístico** y **siempre guarda la sesión** (no se pierde la práctica).
`feedback_source` (`'llm'|'heuristic'`) se persiste en el feedback (JSONB).

## Control de costo y escalamiento (Track B)

Activo solo si existe `SUPABASE_SERVICE_ROLE_KEY`; si no, **fallback** al comportamiento previo.
- **`/api/sessions/start`** (lo llama `phone-ui` ANTES de conectar) → RPC `start_session`:
  enforce **concurrencia (1 llamada/usuario)** + **cuota diaria (60 min)** de forma atómica;
  devuelve `session_id`. `heartbeat` cada 30s lo mantiene vivo; `end` concilia el consumo.
- **Rate limit distribuido** (`rate-limit.ts` → RPC `consume_token` en Postgres), con fallback
  a token bucket en memoria. `enforceRateLimit` es **async**.
- `cron/reap` (cada 15 min) cierra sesiones huérfanas. Metering de costo vía `log.cost`.
- Cliente: `session_id` lo maneja `phone-ui`, **NO** el hook de voz (los reconnects de token
  no disparan falsos `concurrent_limit`).

## Base de datos (Supabase)

Tablas base: `users`, `sessions`, `rankings`, `knowledge_base`*, `methodology`*
(*existen pero no se usan en el flujo actual). RLS en todas.
Cost-control (migración 003): `active_sessions`, `daily_quota`, `rate_limits`.
RPCs clave (SECURITY DEFINER): `update_user_stats`, `recalculate_rankings`, `get_user_names`,
`start_session`, `end_session`, `heartbeat_session`, `reap_stale_sessions`, `consume_token`,
admin (`get_students_overview`, `get_student_detail`, `admin_update_user_role`).
Triggers: alta de usuario (`on_auth_user_created`) y refresh de stats por sesión.

**Migraciones** en `src/lib/supabase/migrations/` (se aplican a mano en el SQL Editor o por CLI):
`001_ranking_cron.sql`, `002_get_user_names_and_indexes.sql` ✅ aplicada,
`003_cost_control.sql` ✅ aplicada. Proyecto Supabase: `lkwlsvoyxysyyigycoah` ("Voice Sales").

## Variables de entorno

```
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, GEMINI_API_KEY
VERTEX_AI_PROJECT_ID, VERTEX_AI_LOCATION, VERTEX_AI_MODEL
CRON_SECRET
SUPABASE_SERVICE_ROLE_KEY   # activa el control de costo (server-only, NUNCA NEXT_PUBLIC_)
# Opcionales: VERTEX_VOICE_USD_PER_MIN, GEMINI_FLASH_INPUT/OUTPUT_USD_PER_MTOK (tarifas para metering)
```

## Comandos

```bash
npm run dev      # localhost:3000
npm run build    # build + typecheck (Turbopack)
npm run lint     # ESLint
npm test         # Vitest (capa-motor)
```

## Gotchas (no obvios)

1. **El motor no puede importar red/Supabase/React/`process.env`** — mantenlo puro y testeable.
2. **El LLM NO calcula números** — la puntuación general la calcula `computeOverallScore`.
3. **Formas de transcript distintas:** hook `{role:'user'|'model', text}` vs DB
   `{role:'user'|'assistant', content, timestamp}` → normaliza con `normalizeForStorage`.
4. **`CallEndReason`** vive en `engine/types` y se re-exporta desde `use-gemini-live` (compat).
5. **Server client de `@supabase/ssr` no se tipa con `<Database>`**; el `admin.ts` tampoco
   (usa `adminRpc()` para los RPC custom).
6. **Límites de llamada solo en el motor** — no los pongas en el prompt.
7. 2 errores `react-hooks/refs` **preexistentes** en `use-gemini-live.ts` (no bloquean build).

## Estado actual / pendiente

- Track A (motor determinista) y Track B (control de costo) **implementados, build+tests verdes**.
- Migraciones 002 y 003 **aplicadas en prod**.
- **Pendiente:** setear `SUPABASE_SERVICE_ROLE_KEY` en Vercel + `.env.local` y redeploy para
  activar el control de costo (mientras tanto corre en fallback sin romperse).
- Escenarios: **se mantienen como JSON estático** (decisión). Añadir nicho = regenerar JSON
  (scripts Python) + actualizar `ALL_NICHOS`/`Nicho`/UI + redeploy.
