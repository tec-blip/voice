# SalesVoice — Guía Técnica para Desarrolladores

> Documento de onboarding para cualquier desarrollador que se integre al proyecto.
> Cubre arquitectura, decisiones técnicas, gotchas y cómo operar la app.

---

## Tabla de contenidos

1. [¿Qué es SalesVoice?](#qué-es-salesvoice)
2. [Stack tecnológico](#stack-tecnológico)
3. [Estructura del proyecto](#estructura-del-proyecto)
4. [Variables de entorno](#variables-de-entorno)
5. [Setup local](#setup-local)
6. [Base de datos — Supabase](#base-de-datos--supabase)
7. [Autenticación](#autenticación)
8. [Sistema de voz — Gemini Live](#sistema-de-voz--gemini-live)
9. [Sistema de evaluación](#sistema-de-evaluación)
10. [API endpoints](#api-endpoints)
11. [Rate limiting](#rate-limiting)
12. [Sistema de badges](#sistema-de-badges)
13. [Cron job de rankings](#cron-job-de-rankings)
14. [Autenticación GCP — Workload Identity Federation](#autenticación-gcp--workload-identity-federation)
15. [Branding y estilos](#branding-y-estilos)
16. [Deployment en Vercel](#deployment-en-vercel)
17. [Gotchas y decisiones no obvias](#gotchas-y-decisiones-no-obvias)

---

## ¿Qué es SalesVoice?

SalesVoice es una app de entrenamiento de ventas por voz. El usuario practica llamadas de venta hablando con un prospecto IA en tiempo real. Al finalizar la llamada, recibe una puntuación detallada en 6 categorías basada en la **Metodología Luis Romero (Closers Digitales)**. Es el producto de entrenamiento de **Sales Hacking**.

**Flujo principal:**
```
Usuario elige nicho + tipo de roleplay
    → Se genera un escenario con datos de clientes reales (CSV Fathom)
    → Se abre WebSocket a Gemini Live
    → Conversación de voz bidireccional en tiempo real
    → Al colgar: transcripción → evaluación con Gemini Flash
    → Resultados + guardado en Supabase + badges actualizados
```

---

## Stack tecnológico

| Capa | Tecnología | Por qué |
|---|---|---|
| Framework | Next.js 16 App Router (TypeScript strict) | SSR/SSG + API routes en un solo repo |
| Auth + DB | Supabase (PostgreSQL + Auth) | RLS nativa, auth out-of-the-box, buen SDK |
| Voz en tiempo real | Google Gemini Live API (WebSocket) | ~$0.04/min vs $0.12-0.18/min de alternativas |
| Evaluación | Gemini 2.5 Flash (REST) | JSON response mode, calibrado para scoring |
| Estilos | Tailwind CSS v4, dark theme (zinc-950) | Utilidad pura, no hay UI library externa |
| Charts | Recharts | Ligero, compatible con React 18 |
| Deploy | Vercel | Integración nativa con Next.js |
| Email | Resend (SMTP) vía Supabase Auth | Email confirmación en dominio propio |

**Idioma de la UI:** Todo en español (es-MX). El target es equipos de ventas LATAM.

---

## Estructura del proyecto

```
salesvoice-main/
├── public/
│   ├── icon.svg                  # Isotipo Sales Hacking (ISOTIPO_ROJO)
│   └── manifest.json             # PWA manifest
│
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── evaluate/
│   │   │   │   └── route.ts      # POST: envía transcripción a Gemini Flash y devuelve scoring
│   │   │   ├── vertex/
│   │   │   │   └── config/
│   │   │   │       └── route.ts  # GET: obtiene access token GCP + URL WebSocket para Gemini Live
│   │   │   ├── sessions/
│   │   │   │   ├── route.ts      # POST: guarda sesión en Supabase + evalúa badges
│   │   │   │   └── list/
│   │   │   │       └── route.ts  # GET: historial de sesiones del usuario
│   │   │   ├── rankings/
│   │   │   │   └── route.ts      # GET: leaderboard global con nombres
│   │   │   ├── scenarios/
│   │   │   │   └── route.ts      # GET: genera un escenario de cliente (nicho + arquetipo)
│   │   │   ├── me/
│   │   │   │   └── route.ts      # GET: perfil del usuario autenticado
│   │   │   ├── admin/
│   │   │   │   └── students/
│   │   │   │       ├── route.ts          # GET: lista todos los alumnos (solo admin)
│   │   │   │       └── [id]/route.ts     # GET/PATCH: detalle y cambio de rol (solo admin)
│   │   │   └── cron/
│   │   │       └── rankings/
│   │   │           └── route.ts  # GET: recalcula rankings (llamado por cron de Vercel)
│   │   │
│   │   ├── auth/
│   │   │   └── callback/
│   │   │       └── route.ts      # OAuth callback — intercambia code por sesión
│   │   │
│   │   ├── dashboard/
│   │   │   ├── layout.tsx        # Layout con sidebar + protección de ruta
│   │   │   ├── page.tsx          # Dashboard: stats, gráfico de progreso, sesiones recientes
│   │   │   ├── practice/
│   │   │   │   └── page.tsx      # Flujo principal: nicho → tipo → llamada → resultados
│   │   │   ├── history/
│   │   │   │   └── page.tsx      # Historial filtrable de sesiones
│   │   │   ├── profile/
│   │   │   │   └── page.tsx      # Perfil: stats personales + colección de badges
│   │   │   ├── ranking/
│   │   │   │   └── page.tsx      # Leaderboard con medallas top 3
│   │   │   ├── onboarding/
│   │   │   │   └── page.tsx      # Tutorial de 4 pasos para usuarios nuevos
│   │   │   └── admin/
│   │   │       └── students/
│   │   │           └── page.tsx  # Panel admin: listado de alumnos (solo role='admin')
│   │   │
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   │
│   ├── components/
│   │   ├── auth/
│   │   │   ├── login-form.tsx
│   │   │   └── register-form.tsx
│   │   ├── dashboard/
│   │   │   ├── feedback-card.tsx  # Visualización del scoring de 6 categorías
│   │   │   └── progress-chart.tsx # Gráfico de evolución de puntuaciones
│   │   ├── layout/
│   │   │   └── sidebar.tsx        # Sidebar con navegación + rol-aware (admin link)
│   │   ├── phone/
│   │   │   ├── phone-ui.tsx       # Interfaz de teléfono: botones, estado de llamada
│   │   │   └── audio-visualizer.tsx
│   │   └── ui/
│   │       ├── sales-voice-logo.tsx  # Isotipo SVG con animación de barras de audio
│   │       └── ...                    # Button, Card, Input, Badge, Avatar, etc.
│   │
│   ├── lib/
│   │   ├── hooks/
│   │   │   ├── use-gemini-live.ts   # WebSocket Gemini Live: audio PCM, reconexión, function calling
│   │   │   ├── use-microphone.ts    # Captura micrófono a 16kHz mono via Web Audio API
│   │   │   ├── use-auth.ts          # Estado de auth + signOut
│   │   │   └── use-user-role.ts     # Rol del usuario (alumno/instructor/admin)
│   │   ├── prompts/
│   │   │   ├── roleplay.ts          # 5 tipos de roleplay con system prompts en español
│   │   │   └── evaluation.ts        # Prompt de evaluación Luis Romero + tipo EvaluationResult
│   │   ├── supabase/
│   │   │   ├── client.ts            # Browser Supabase client (@supabase/ssr)
│   │   │   ├── server.ts            # Server Supabase client con cookie handling
│   │   │   ├── middleware.ts        # Refresco de sesión + protección de rutas
│   │   │   └── schema.sql           # Schema completo — ejecutar en Supabase SQL Editor
│   │   ├── types/
│   │   │   └── database.ts          # Tipos TS: Database, TranscriptEntry, FeedbackScores, etc.
│   │   ├── utils/
│   │   │   ├── badge-logic.ts       # Evaluación y persistencia de badges post-sesión
│   │   │   └── badges.ts            # Definiciones de los 10 badges (id, label, icono, condición)
│   │   └── rate-limit.ts            # Token bucket in-memory por clave de usuario
│   │
│   └── middleware.ts                # Entry point del middleware Next.js
│
├── vercel.json                      # Config deploy: región, cron, headers
└── DEVELOPER.md                     # Este archivo
```

---

## Variables de entorno

Crea `.env.local` con:

```bash
# ── Supabase ────────────────────────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# ── Gemini (evaluación REST — Gemini Flash) ──────────────────────────────────
GEMINI_API_KEY=AIza...

# ── Vertex AI (Gemini Live WebSocket — voz en tiempo real) ───────────────────
# Proyecto GCP donde está habilitado Vertex AI
VERTEX_AI_PROJECT_ID=mi-proyecto-gcp
# Región (default: us-central1)
VERTEX_AI_LOCATION=us-central1
# Modelo de audio (default: gemini-live-2.5-flash-native-audio)
VERTEX_AI_MODEL=gemini-live-2.5-flash-native-audio

# ── Auth GCP en producción — usar WIF (ver sección WIF más abajo) ────────────
# Solo necesario en local o como fallback si WIF no está configurado:
# GOOGLE_CREDENTIALS_JSON={"type":"service_account","project_id":"..."}

# ── Cron seguridad ────────────────────────────────────────────────────────────
CRON_SECRET=un_secreto_largo_y_aleatorio
```

**En Vercel**, estas variables se configuran en Settings → Environment Variables. `GOOGLE_CREDENTIALS_JSON` NO debe estar en producción si tienes WIF configurado.

---

## Setup local

```bash
# 1. Instalar dependencias
npm install

# 2. Copiar y completar variables de entorno
cp .env.local.example .env.local

# 3. Ejecutar schema en Supabase
# Abre Supabase → SQL Editor → pega el contenido de src/lib/supabase/schema.sql
# Solo necesitas hacerlo una vez (o al resetear la DB)

# 4. Para Gemini Live en local, necesitas ADC de Google Cloud:
gcloud auth application-default login

# 5. Iniciar el servidor
npm run dev       # http://localhost:3000
npm run build     # Build de producción
npm run lint      # TypeScript + ESLint
```

**Importante para local:** `use-gemini-live.ts` llama a `/api/vertex/config` para obtener el token. Si no tienes WIF ni `GOOGLE_CREDENTIALS_JSON`, el endpoint intenta usar ADC (Application Default Credentials). Ejecuta `gcloud auth application-default login` una vez y funciona.

---

## Base de datos — Supabase

### Tablas

| Tabla | Descripción |
|---|---|
| `users` | Perfil del usuario (name, email, role). Se crea automáticamente al registrarse vía trigger. |
| `sessions` | Cada llamada de práctica completada. Almacena transcript (JSONB), feedback (JSONB), score, duration. |
| `rankings` | Una fila por usuario. Se recalcula automáticamente vía trigger tras cada sesión. Guarda badges (JSONB array). |
| `knowledge_base` | Escenarios de práctica adicionales. No se usa activamente en el flujo principal (el CSV de Fathom se usa directo). |
| `methodology` | Criterios de evaluación. Datos de referencia, no se consulta en el flujo normal. |

### Row Level Security (RLS)

**Todas las tablas tienen RLS activado.** Las políticas clave:

- **`users`**: Un usuario solo puede ver y editar su propia fila. Los admins pueden ver todas.
- **`sessions`**: Un usuario solo ve sus propias sesiones. Instructores/admins ven todas.
- **`rankings`**: Lectura pública (el leaderboard es abierto). Escritura solo desde SECURITY DEFINER.
- **`knowledge_base` / `methodology`**: Lectura pública. Escritura solo para admins.

**Funciones SECURITY DEFINER importantes:**

```sql
-- Verifica si el usuario actual es admin (sin recursión)
public.is_admin() → boolean

-- Verifica si es instructor o admin
public.is_instructor_or_admin() → boolean

-- Actualiza stats de ranking de un usuario
public.update_ranking(p_user_id uuid) → void

-- Admin: overview de todos los alumnos
public.get_students_overview() → tabla

-- Admin: detalle completo de un alumno (sesiones + ranking)
public.get_student_detail(p_student_id uuid) → jsonb

-- Admin: cambiar el rol de un usuario
public.admin_update_user_role(p_user_id uuid, p_role text) → jsonb
```

### Trigger de rankings

Cada vez que se inserta, actualiza o elimina una sesión, el trigger `sessions_refresh_ranking_trg` llama automáticamente a `update_ranking()`. **No necesitas recalcular manualmente el ranking desde el cliente** — el trigger lo hace.

### Trigger de signup

Al registrarse un usuario nuevo en Supabase Auth, el trigger `on_auth_user_created` crea automáticamente su fila en `public.users` (role='alumno') y en `public.rankings` (todo a cero).

### Roles de usuario

| Rol | Acceso |
|---|---|
| `alumno` | Solo ve sus propias sesiones y el leaderboard público |
| `instructor` | Puede ver sesiones de todos los alumnos |
| `admin` | Acceso total: panel admin, cambio de roles, gestión de knowledge base |

Para promover a alguien a admin, un admin existente debe usar el panel en `/dashboard/admin/students` o llamar directamente a la función `admin_update_user_role` desde Supabase SQL Editor:
```sql
SELECT public.admin_update_user_role('uuid-del-usuario', 'admin');
```

---

## Autenticación

Usa **Supabase Auth** con email/password. El flujo:

1. `register/page.tsx` → `RegisterForm` → `supabase.auth.signUp()` → Supabase envía email de confirmación vía Resend SMTP
2. Usuario confirma email → redirige a `/auth/callback` → `supabase.auth.exchangeCodeForSession()` → cookie de sesión
3. `middleware.ts` refresca el access token en cada request a `/dashboard/*` y `/api/*`
4. En API routes: `const { data: { user } } = await supabase.auth.getUser()` — siempre verificar que no es null

**Email:** Configurado con Resend SMTP en Supabase Auth → Settings → SMTP. Host: `smtp.resend.com`, puerto `465`, usuario `resend`, password = API key de Resend. El dominio del remitente debe estar verificado en Resend.

**Sesión persistente:** Las cookies de Supabase se manejan automáticamente por `@supabase/ssr`. No uses `localStorage` para guardar tokens.

---

## Sistema de voz — Gemini Live

Este es el componente más complejo. Entiéndelo antes de tocar algo.

### Flujo de audio

```
Micrófono (Float32, 16kHz) 
  → floatTo16BitPCM() → Int16Array 
  → base64Encode() 
  → WebSocket → Gemini Live API
  → Respuesta: base64 PCM a 24kHz
  → base64Decode() → Int16Array 
  → int16ToFloat32()
  → AudioBuffer(24kHz) → AudioContext → Speaker
```

### Componentes involucrados

| Archivo | Responsabilidad |
|---|---|
| `use-microphone.ts` | Captura micrófono via `getUserMedia` + ScriptProcessor. Emite `Float32Array` chunks. |
| `use-gemini-live.ts` | Toda la lógica de conexión WebSocket, encoding/decoding PCM, playback schedulado, reconexión. |
| `phone-ui.tsx` | Orquesta la llamada: conecta el hook, maneja estados (idle/calling/active/ended), detecta colgado. |
| `/api/vertex/config` | Obtiene el access token GCP y construye la URL del WebSocket. El token dura ~1h. |

### Setup del WebSocket (`ws.onopen`)

Al conectar, se envía un mensaje `setup` con:
- **Modelo:** `gemini-live-2.5-flash-native-audio` (ajustable con `VERTEX_AI_MODEL`)
- **Voz:** Por defecto `Kore` (femenino suave). Se puede cambiar por escenario con `getVoiceByGender()`
- **VAD configurado:** `silenceDurationMs: 400ms` — detecta fin de habla rápido sin cortar pausas normales
- **Transcripción:** `inputAudioTranscription` y `outputAudioTranscription` habilitados — Gemini transcribe los dos lados
- **Tool declaration:** `end_call` — el modelo puede llamar esta función para colgar la llamada

### Playback schedulado

El audio de respuesta llega en múltiples chunks. Se usa `AudioBufferSourceNode` schedulado con un buffer de 20ms de anticipación para que los chunks suenen sin interrupciones:

```
nextPlayTime = max(ctx.currentTime + 0.02, nextPlayTime)
source.start(nextPlayTime)
nextPlayTime += buffer.duration
```

### Barge-in (interrupción por el usuario)

Cuando el usuario habla mientras el modelo habla:
1. Gemini envía `{ serverContent: { interrupted: true } }`
2. `stopPlayback()` se llama: limpia los `AudioBufferSourceNode` en cola y los detiene
3. **CRÍTICO:** Antes de llamar `s.stop()`, se hace `s.onended = null` para evitar que los callbacks de audio ya terminado disparen el hangup pendiente accidentalmente

### Function calling — `end_call`

El modelo llama a `end_call` cuando la conversación termina naturalmente. El flujo:
1. `data.toolCall.functionCalls` → detectamos `end_call` → guardamos en `pendingHangupRef`
2. Respondemos con `{ toolResponse: { functionResponses: [{ ok: true }] } }`
3. El modelo termina de hablar (despedida de audio)
4. Cuando `activeSourcesRef` queda vacío (último `source.onended`) → se dispara `onModelHangup`
5. `phone-ui.tsx` recibe el evento y cierra la UI

**Guardia de duración mínima:** En `phone-ui.tsx`, si `end_call` llega con menos de 30 segundos desde que empezó la llamada, se ignora. Esto evita colgadas prematuras por barge-in al inicio.

### Session resumption

Gemini Live corta sesiones largas (~45 min). Para manejar esto:
- Gemini emite `sessionResumptionUpdate.newHandle` cada ~60s
- Guardamos el handle en `sessionHandleRef`
- Si el WebSocket se cierra inesperadamente y tenemos handle, reintentamos hasta 3 veces con backoff lineal (500ms × intento)
- Cada reintento pide un **token GCP fresco** (el token expira en ~1h)

### Reconexión mobile (visibilitychange)

En móviles, bloquear la pantalla suspende el `AudioContext` y puede matar el WebSocket. El hook registra un listener en `document.visibilitychange`:
- Al volver visible: resume el `AudioContext` si está suspendido
- Si el WebSocket está cerrado: intenta reconectar usando el handle

### iOS Safari — Consideraciones especiales

- **No forzar `sampleRate`** al crear `AudioContext`: iOS Safari lo rechaza silenciosamente. Se crea sin `sampleRate` y los buffers de 24kHz se resamplean automáticamente
- **`webkitAudioContext`** fallback en iOS < 14: el hook lo detecta vía `getAudioContextClass()`

---

## Sistema de evaluación

Después de cada llamada, `practice/page.tsx` llama a `/api/evaluate` con la transcripción formateada.

### Flujo

```
transcript[] (raw del hook)
  → formatTranscriptForEvaluation()
      → "VENDEDOR: ..." + "PROSPECTO: ..."
  → POST /api/evaluate
      → EVALUATION_PROMPT + transcript
      → Gemini 2.5 Flash (JSON mode, temperature 0.3)
      → EvaluationResult JSON
  → POST /api/sessions (transcript normalizado + feedback)
```

### Categorías de evaluación (0-100 cada una)

| Categoría | Descripción |
|---|---|
| `apertura` | Rapport + marco de llamada + motivo de agendado |
| `descubrimiento` | Situación + dolor emocional + visión + intentos previos |
| `presentacion` | Resumen espejo + pitch conectado al dolor |
| `objeciones` | Manejo sin justificar precio, redirigir al dolor |
| `cierre` | VSO (Verificación de Situación Objetivo) antes del pitch + cierre directo |
| `tono` | Liderazgo, autoridad, energía, sin needy energy |

`puntuacion_general` = promedio ponderado (descubrimiento ×2, cierre ×2, objeciones ×1.5, resto ×1).

### Escala de puntuación

| Rango | Nivel |
|---|---|
| 85-100 | Closer de élite |
| 70-84 | Closer avanzado |
| 55-69 | En desarrollo |
| 40-54 | Principiante |
| 0-39 | Básico |

### Fallback de modelos

`/api/evaluate` intenta los modelos en orden: `gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-flash-latest`. Si uno falla con 429 (rate limit), espera 4s y reintenta. Timeout de 55s por intento.

---

## API endpoints

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `POST` | `/api/evaluate` | ✅ usuario | Evalúa una transcripción formateada. Rate limit: 10/hora |
| `GET` | `/api/vertex/config` | ✅ usuario | Access token GCP + URL WebSocket Gemini Live. Rate limit: 6/min. Verifica cuota diaria (60 min/día) |
| `POST` | `/api/sessions` | ✅ usuario | Guarda sesión completa en Supabase + evalúa badges |
| `GET` | `/api/sessions/list` | ✅ usuario | Historial de sesiones del usuario autenticado |
| `GET` | `/api/rankings` | ✅ usuario | Leaderboard global con nombres de usuario |
| `GET` | `/api/scenarios` | ✅ usuario | Genera escenario de cliente (nicho `?nicho=trading\|marca_personal_instagram\|aleatorio`) |
| `GET` | `/api/me` | ✅ usuario | Perfil del usuario (stats + badges) |
| `GET` | `/api/admin/students` | ✅ admin | Lista todos los alumnos con sus stats |
| `GET/PATCH` | `/api/admin/students/[id]` | ✅ admin | Detalle de alumno / cambio de rol |
| `GET` | `/api/cron/rankings` | 🔑 CRON_SECRET | Recalcula todos los rankings (llamado por Vercel cron) |
| `GET` | `/auth/callback` | — | OAuth callback de Supabase |

### Validación en `/api/sessions`

El endpoint tiene validación estricta. El body esperado:

```typescript
{
  type: 'cierre' | 'llamada_fria' | 'framing' | 'general' | 'objeciones',
  score: number,          // 0-100
  duration: number,       // segundos, max 3600
  transcript: Array<{     // max 800 entries
    role: 'user' | 'assistant',
    content: string,      // max 4000 chars
    timestamp: string,    // ISO string
  }>,
  feedback: {             // EvaluationResult shape
    apertura: number,
    descubrimiento: number,
    presentacion: number,
    objeciones: number,
    cierre: number,
    tono: number,
    feedback_positivo: string,
    feedback_mejora: string,
    momento_critico: string,
    // puntuacion_general se ignora (no está en FeedbackScores)
  }
}
```

**Nota importante:** `use-gemini-live.ts` produce transcript con `{ role: 'user'|'model', text: string }`. En `practice/page.tsx`, antes de enviar a `/api/sessions`, se normaliza: `'model' → 'assistant'`, `text → content`, se añade `timestamp`. Si cambias la forma del transcript en el hook, actualiza también la normalización en `handleCallEnd`.

---

## Rate limiting

Implementado en `src/lib/rate-limit.ts` como **token bucket en memoria**.

```
enforceRateLimit(`clave:${user.id}`, { capacity: N, windowMs: ms })
// → null si OK
// → NextResponse 429 si excede el límite
```

**Límites configurados:**

| Endpoint | Límite |
|---|---|
| `/api/evaluate` | 10 evaluaciones / hora / usuario |
| `/api/vertex/config` | 6 requests / minuto / usuario |
| Cuota diaria de práctica | 60 min / día / usuario (en `/api/vertex/config`) |

**Limitación conocida:** Es in-memory por instancia Lambda. Si Vercel escala a múltiples instancias, cada una tiene su propio bucket. Funciona para parar click-spam y bucles, pero no es una garantía estricta distribuida. Si se necesita eso, migrar a **Upstash Redis** manteniendo la misma interfaz `enforceRateLimit(key, opts)`.

---

## Sistema de badges

10 badges definidos en `src/lib/utils/badges.ts`. Se evalúan y persisten en `rankings.badges` (array JSONB) cada vez que se guarda una sesión exitosa.

| Badge ID | Condición de desbloqueo |
|---|---|
| `first_call` | Primera sesión completada |
| `sessions_10` | 10 sesiones completadas |
| `sessions_50` | 50 sesiones completadas |
| `score_80` | Al menos una sesión con score ≥ 80 |
| `score_90` | Al menos una sesión con score ≥ 90 |
| `perfect_close` | Categoría `cierre` ≥ 90 en alguna sesión |
| `all_types` | Practicó los 5 tipos de roleplay al menos una vez |
| `improvement` | Las 3 sesiones más recientes tienen scores ascendentes |
| `streak_3` | Práctica 3 días consecutivos |
| `streak_7` | Práctica 7 días consecutivos |

**Nota sobre streak:** Se considera que la racha sigue activa si hay sesión hoy **o** ayer. Así no se rompe por no haber practicado todavía hoy.

**Los badges no se quitan** — la función `evaluateBadges` solo añade badges nuevos al set existente. Una vez ganado, permanente.

---

## Cron job de rankings

`vercel.json` configura un cron que llama a `/api/cron/rankings` todos los días a las **3:00 AM UTC**:

```json
"crons": [{ "path": "/api/cron/rankings", "schedule": "0 3 * * *" }]
```

El endpoint está protegido con `Authorization: Bearer <CRON_SECRET>`. Vercel lo envía automáticamente. Si llamas el endpoint manualmente en staging o testing:

```bash
curl -H "Authorization: Bearer tu_cron_secret" https://tu-dominio.com/api/cron/rankings
```

El cron llama a `supabase.rpc('recalculate_rankings')` que recalcula ranks globales para todos los usuarios. El trigger de `sessions` mantiene los stats individuales en tiempo real; el cron es para reordenar el ranking global cuando haya inconsistencias.

---

## Autenticación GCP — Workload Identity Federation

Gemini Live corre sobre **Vertex AI** (no la API pública de Gemini). Vertex requiere un access token OAuth2 de Google Cloud, no una API key.

### En producción (Vercel)

Se usa **Workload Identity Federation** para que Vercel pueda obtener tokens GCP sin guardar service account keys como secretos:

1. Vercel genera un OIDC token firmado por su propia CA (`getVercelOidcToken()`)
2. El endpoint `/api/vertex/config` lo intercambia en GCP STS → federated token
3. Ese federated token se usa para impersonar el service account `salesvoice-vertexai@...` → access token final
4. El access token se pasa como query param en la URL del WebSocket

**Datos del pool WIF (están hardcodeados en `route.ts`):**
- Pool: `vercel-pool`
- Provider: `vercel-provider`
- Project GCP: `ethereal-audio-494220-t6`
- Service Account: `salesvoice-vertexai@ethereal-audio-494220-t6.iam.gserviceaccount.com`

El access token expira en **1 hora**. Cuando el WebSocket se reconecta, siempre pide un token fresco.

### En local

- Si tienes `gcloud auth application-default login` → usa ADC automáticamente
- Alternativa: poner `GOOGLE_CREDENTIALS_JSON` en `.env.local` con el JSON del service account

### Fallback en Vercel (sin WIF)

Si WIF no está disponible, el endpoint busca `GOOGLE_CREDENTIALS_JSON` como variable de entorno en Vercel. Es menos seguro (exposición de credenciales) pero funciona para testing rápido.

---

## Branding y estilos

### Paleta de colores

La app usa el branding de **Sales Hacking**:
- **Color primario:** `#C8001A` (rojo oscuro) — isotipo SVG
- **Color de acción UI:** `red-600` / `#dc2626` (Tailwind) — botones, activos, bordes
- **Background:** `zinc-950` → `zinc-900` → `zinc-800` (gradiente oscuro)
- Todos los elementos interactivos activos usan `border-red-500` / `bg-red-600/10` / `text-red-400`

**No uses `blue-*` en ningún componente nuevo.** La paleta era azul originalmente y se migró completamente a rojo.

### Logo (`SalesVoiceLogo`)

El componente en `src/components/ui/sales-voice-logo.tsx` renderiza el isotipo exacto de Sales Hacking (paths SVG originales de `ISOTIPO_ROJO.svg`) con:
- `fill="#C8001A"` fijo
- `size` prop: altura en px (el ancho se calcula automáticamente con ratio 620:712)
- `animated` prop: muestra 5 barras de audio animadas debajo del logo (ecualizador sutil)

Úsalo en cualquier header o pantalla de bienvenida:
```tsx
<SalesVoiceLogo size={72} animated />       // Login / Register
<SalesVoiceLogo size={36} animated={false} /> // Sidebar
```

---

## Deployment en Vercel

### Primera vez

1. Conectar el repo en Vercel (importar desde GitHub)
2. Configurar todas las variables de entorno (ver sección Variables de entorno)
3. Habilitar **Vercel OIDC** en Settings → General del proyecto (necesario para WIF con GCP)
4. El dominio personalizado ya está configurado en Supabase Auth → URL Configuration

### Configuración en `vercel.json`

```json
{
  "framework": "nextjs",
  "regions": ["iad1"],        // us-east-1 — cercano a Supabase y Vertex AI us-central1
  "crons": [...],
  "headers": [...]
}
```

### Supabase — URLs a configurar

En Supabase → Authentication → URL Configuration:
- **Site URL:** `https://tu-dominio.com`
- **Redirect URLs:** `https://tu-dominio.com/auth/callback`

### Resend — SMTP

En Supabase → Authentication → SMTP Settings:
- Host: `smtp.resend.com`
- Port: `465`
- User: `resend`
- Password: API key de Resend
- From: `no-reply@tu-dominio.com` (el dominio debe estar verificado en Resend)

---

## Gotchas y decisiones no obvias

### 1. `use-gemini-live.ts` no es un componente — es un hook

No renderiza nada. Lo usa `PhoneUI` como único consumidor. Si necesitas escuchar eventos de voz en otro lugar, hazlo a través de `PhoneUI` pasando callbacks.

### 2. El transcript del hook y el de la DB tienen formas distintas

- **En el hook:** `{ role: 'user' | 'model', text: string }`
- **En la DB:** `{ role: 'user' | 'assistant', content: string, timestamp: string }`

La normalización ocurre en `practice/page.tsx` en `handleCallEnd` antes del `fetch('/api/sessions')`. No olvides esto si cambias el hook.

### 3. `SupabaseClient<Database>` nunca usar con el server client

Los server clients de `@supabase/ssr` no están parametrizados con el tipo `Database` de la misma forma. Si intentas tipar un parámetro como `SupabaseClient<Database>`, TypeScript devuelve `never` en los `.data`. Usa siempre:

```typescript
type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>
```

### 4. El middleware debe incluir `/api/*`

Sin el matcher de `/api/*` en `middleware.ts`, el token de Supabase no se refresca antes de que las API routes intenten leer `user`. Después de ~1h de inactividad, todas las API routes devuelven 401 aunque el navegador tenga cookies válidas.

### 5. iOS Safari no acepta `sampleRate` forzado

Si creas `new AudioContext({ sampleRate: 24000 })`, iOS Safari lo silencia o lo ignora sin error. Siempre crea el contexto sin `sampleRate` y los AudioBuffers de 24kHz se resamplean automáticamente al destination.

### 6. `s.onended = null` antes de `s.stop()`

En `stopPlayback()`, hay que nullificar el callback `onended` ANTES de llamar `s.stop()`. Si no, el callback se dispara con el audio aún cargado en `activeSourcesRef`, cuenta como "audio terminado" y puede ejecutar el hangup pendiente por error.

### 7. Los badges no se pueden quitar programáticamente

`evaluateBadges` hace un `Set.union` con los badges existentes. Si necesitas quitar un badge (por bug, corrección), hay que hacerlo directamente en Supabase SQL:
```sql
UPDATE rankings SET badges = '[]'::jsonb WHERE user_id = 'uuid';
```

### 8. El cron de rankings requiere Vercel Pro/Enterprise

Los cron jobs en `vercel.json` solo funcionan en planes pagados de Vercel. En el plan gratuito, el endpoint existe pero no se llama automáticamente.

### 9. Límite de 45 min por llamada

El sistema prompt de cada roleplay incluye instrucciones para que el modelo cuelgue a los 45 minutos. Adicionalmente, la cuota diaria de 1 hora por usuario está en `/api/vertex/config`. El límite del WebSocket de Gemini Live también tiene un máximo de sesión.

### 10. `goAway` y pre-fetch de token

Cuando Gemini envía `goAway`, significa que va a cerrar el WebSocket en ~30 segundos. El hook aprovecha ese tiempo para hacer un pre-fetch del nuevo token GCP. Así, cuando `ws.onclose` dispara, el token fresco ya está listo y la reconexión es casi instantánea.

---

## Comandos útiles

```bash
# Dev
npm run dev

# Build y verificación de tipos
npm run build

# Lint
npm run lint

# Ver logs en Vercel
vercel logs --follow

# Probar el cron manualmente (local)
curl -H "Authorization: Bearer ${CRON_SECRET}" http://localhost:3000/api/cron/rankings

# Reset rankings en Supabase (útil en staging)
SELECT public.update_ranking(id) FROM public.users;
```
