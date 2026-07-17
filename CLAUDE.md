# SalesVoice — Contexto central del proyecto

> **LÉEME ANTES DE TOCAR NADA.** Este es el contrato que cualquier asistente IA (o dev)
> debe seguir. Si vas a continuar el desarrollo: lee esta página completa + la sección
> **"Reglas para contribuir"**, y registra tus cambios en [CHANGELOG.md](./CHANGELOG.md).
> Historial cronológico: [CHANGELOG.md](./CHANGELOG.md) · Detalle técnico: [DEVELOPER.md](./DEVELOPER.md).
> Mantén este archivo actualizado al hacer cambios estructurales.
> Última actualización: 2026-07-06.

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

## Reglas para contribuir (el siguiente agente DEBE seguirlas)

1. **Diagnostica con DATOS reales, no supongas.** Antes de "arreglar" un bug de llamada,
   consulta la sesión afectada: `select events, transcript from sessions where ...` (los
   `events` registran connect/go_away/end_call/reconnect/ws_close). Verifica la hipótesis
   contra la BD (proyecto Supabase `lkwlsvoyxysyyigycoah`) antes de tocar código.
2. **Motor puro** (`src/lib/engine/`): sin `fetch`/Supabase/`process.env`/`next/*`/React.
   Toda lógica determinista va aquí, con test Vitest. La IA solo donde se necesita semántica.
3. **El LLM NO decide reglas de negocio.** No calcula la puntuación general (la calcula
   `computeOverallScore`), no decide los límites de tiempo (los aplica `engine/call-lifecycle`),
   no declara el cierre exitoso en arco completo (ver "Prompts y roleplay").
4. **Prompts del prospecto** (`src/lib/prompts/roleplay.ts`): el `ROLE_LOCK` es **fuente única**
   inyectada en todas las bases — el prospecto es un CLIENTE particular, usa su `nombre` del
   caso, NUNCA vende ni se presenta como la empresa/"Luis Romero". NO pongas umbrales de tiempo
   en el prompt (viven en el motor).
5. **Secretos server-only.** Nunca prefijes con `NEXT_PUBLIC_` una clave/secreto
   (`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, etc.).
6. **DDL solo al proyecto correcto** (`lkwlsvoyxysyyigycoah`). Añade la migración en
   `src/lib/supabase/migrations/` Y aplícala. No apliques SQL a un proyecto "adivinado".
7. **Antes de commitear:** `npm test` + `npm run build` + `npm run lint` verdes. El flujo de
   voz NO se puede probar headless (necesita auth+mic+Gemini) → valídalo con una llamada real.
8. **Cada cambio relevante → una entrada en [CHANGELOG.md](./CHANGELOG.md)** y, si es
   estructural, actualiza este archivo.
9. **Deploy = push a `main`** (Vercel despliega solo). Si `git push` da 403 (`vh-ia`):
   `printf "protocol=https\nhost=github.com\n\n" | git credential reject` y reintenta con la
   cuenta `yltamayoia`.

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
  data/scenarios.json            # ~1011 escenarios estáticos (trading + marca_personal_instagram)
scripts/
  extract-call-profiles.py       # CSV Fathom → profiles.jsonl (usa Gemini; corre 1 vez)
  aggregate-roleplay-assets.py   # profiles.jsonl → archetypes/objections (cap ahora configurable)
  build-scenarios.mjs            # ⭐ profiles.jsonl → src/data/scenarios.json (Node, SIN LLM, sin cap)
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

## Prompts y roleplay (`src/lib/prompts/roleplay.ts`)

- `buildScenarioPrompt(type, scenario)` arma el prompt del prospecto inyectando UN caso real
  (de `scenarios.json`, elegido por `/api/scenarios?nicho=`). El caso aporta identidad
  (`estado_inicial.nombre`), dolor, objeciones, país, muletillas, frases. La voz se elige por
  género (`getVoiceByGender`). Si no hay escenario, cae al prompt estático `getRoleplayPrompt`.
- **`ROLE_LOCK`** (fuente única) fija el rol: prospecto = cliente particular; usa su nombre del
  caso; nunca vende ni se presenta como empresa/"Luis Romero"; nada de "¿en qué puedo ayudarte?".
- **Política de fin de llamada (arco completo: general/cierre/llamada_fria/framing):** el modelo
  NO puede autocolgar con `cierre_exitoso` (lo bloquea `engine.canModelUseReason`); el cierre lo
  marca el usuario colgando. Solo puede cerrar con `sin_interes`/`objeciones_no_resueltas`/`timeout`.
  El drill `objeciones` SÍ permite `cierre_exitoso`. Al bloquear, el hook re-engancha (no queda mudo).
- **`go_away` de Gemini** (límite ~10 min de sesión): `use-gemini-live.ts` reconecta
  PROACTIVAMENTE (con el handle de resumption) para cruzar el límite sin corte; el modelo no
  usa el fin de sesión como señal para colgar.

### Regenerar escenarios (tras subir más CSVs de Fathom)
1. `python scripts/extract-call-profiles.py` (CSV → `scripts/data/profiles.jsonl`; usa Gemini).
2. `node scripts/build-scenarios.mjs` (→ `src/data/scenarios.json`, SIN LLM, sin cap, con nombres).
3. Si es nicho nuevo: actualiza `ALL_NICHOS` (`api/scenarios/route.ts`), `Nicho`/`NICHO_LABELS`
   (`roleplay.ts`) y la lista de la UI (`practice/page.tsx`). Commit + push.
> Nota: NO reintroduzcas el cap de 30 que tenía `aggregate-roleplay-assets.py` (descartaba ~980
> casos reales usables). El histórico de ese bug está en [CHANGELOG.md](./CHANGELOG.md) (2026-07-06).

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

**Migraciones** en `src/lib/supabase/migrations/` (se aplican por MCP o SQL Editor). Aplicadas
en prod: `001_ranking_cron`, `002_get_user_names_and_indexes`, `003_cost_control`,
`004` (columna `sessions.events`), `005_security_phase0`, `006_end_session_server_time`,
`007_sync_user_badges`. Proyecto Supabase: `lkwlsvoyxysyyigycoah` ("Voice Sales").

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

- Track A (motor determinista) y Track B (control de costo): **en prod**. Migraciones 001–007
  aplicadas. Todas las fases de la auditoría 2026-06 (seguridad/voz/producto): **desplegadas**.
- **~1011 escenarios** activos (541 trading + 470 marca). Escenarios siguen como **JSON estático**
  (regenerar con `build-scenarios.mjs`); migrarlos a la BD (`knowledge_base`) es mejora futura.
- **Pendientes conocidos (bajo impacto):**
  - Confirmar `SUPABASE_SERVICE_ROLE_KEY` en Vercel para el control de costo (si no, corre en fallback).
  - Activar "Leaked password protection" en el dashboard de Supabase (1 clic).
  - Punto ciego: las llamadas que fallan al conectar (onError) no dejan fila/events en la BD.
  - Cosmético: stats del dashboard sobre ventana de 20; toast de badge; racha en UTC vs tz LATAM.
- **Historial de cambios:** [CHANGELOG.md](./CHANGELOG.md).
