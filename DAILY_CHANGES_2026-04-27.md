# SalesVoice — Informe Técnico del Día 27/04/2026

## Resumen Ejecutivo

Se resolvieron dos problemas críticos que impedían el funcionamiento de la app en condiciones de producción real:

1. **Los roleplays no funcionaban en dispositivos móviles** (iOS Safari y Android Chrome) — problema de captura de audio.
2. **Credenciales de Google Cloud expiraban cada pocos días** — problema de autenticación en producción.

Ambos problemas quedaron resueltos con tres commits deployados en Vercel Pro. La app está operativa en `voice-jade.vercel.app` y, por primera vez, autentica con Google Cloud sin credenciales personales que expiren.

---

## Commits del Día

```
77e6054  fix: roleplays funcionan en móvil (iOS Safari + Android)
df5d735  chore: better diagnostics in /api/vertex/config
777ea8a  fix: use @vercel/functions/oidc helper to get OIDC token
```

---

## Cambio 1 — Soporte Real para Dispositivos Móviles

**Commit:** `77e6054`
**Archivos modificados:** `use-microphone.ts`, `use-gemini-live.ts`, `phone-ui.tsx`
**Impacto:** Los usuarios de iOS y Android ahora pueden iniciar y mantener roleplays de voz.

### El Problema Raíz

El código original forzaba un `sampleRate` de 16.000 Hz tanto en `getUserMedia` como en el constructor de `AudioContext`:

```typescript
// ANTES — roto en iOS:
navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000 } })
new AudioContext({ sampleRate: 16000 })
```

iOS Safari **ignora silenciosamente** la constraint de `sampleRate` en `getUserMedia` y **rechaza** el `sampleRate` forzado en `AudioContext` (o lo crea en estado `suspended`). El resultado era que la llamada nunca arrancaba en móvil, sin ningún mensaje de error visible para el usuario.

El mismo problema afectaba al playback: el audio de Gemini llegaba a 24 kHz y el `AudioContext` de reproducción también tenía `sampleRate` forzado.

### Lo que Se Cambió

**`use-microphone.ts` — captura de audio:**

- Se eliminó el `sampleRate` forzado en `getUserMedia` y `AudioContext`.
- Se agregó `webkitAudioContext` como fallback para iOS Safari < 14.
- Se añade `audioContext.resume()` tras el gesto del usuario (iOS crea el contexto en estado `suspended` por defecto).
- Se implementó **downsampling manual**: el dispositivo captura al rate nativo (44.1 kHz o 48 kHz) y el código lo reduce a 16 kHz mediante promediado de muestras antes de enviarlo a Gemini. Este paso es necesario porque Gemini Live API espera exactamente 16 kHz.
- El `bufferSize` del `ScriptProcessorNode` se ajusta dinámicamente según el sample rate nativo para mantener una latencia constante de ~85 ms.
- Se añadió manejo específico de errores del navegador con mensajes en español: `NotAllowedError` (permiso denegado), `NotFoundError` (sin micrófono), `NotReadableError` (mic en uso por otra app), `SecurityError` (requiere HTTPS), etc.

**`use-gemini-live.ts` — reproducción de audio:**

- Se eliminó el `sampleRate` forzado en el `AudioContext` de playback.
- El `AudioBuffer` sigue creándose a 24 kHz (que es el rate que entrega Gemini), pero el navegador hace el resampling al hardware de forma nativa y correcta.
- Se agrega `ctx.resume()` automático cuando llega audio y el contexto está suspendido (ocurre cuando el usuario minimiza la app en iOS y vuelve).

**`phone-ui.tsx` — interfaz de usuario:**

- Se añadió un banner de error rojo visible en pantalla cuando el micrófono falla.
- Antes los errores se silenciaban en `catch {}` y el usuario solo veía que nada pasaba.

---

## Cambio 2 — Diagnóstico de Autenticación

**Commit:** `df5d735`
**Archivos modificados:** `src/app/api/vertex/config/route.ts`
**Impacto:** Hizo posible identificar exactamente qué path de autenticación se estaba usando en producción.

### Lo que Se Cambió

Se agregaron logs estructurados que aparecen en Vercel Functions → Logs:

```
[vertex/config] auth path: credentials_json (no OIDC token disponible)
[vertex/config] FAILED { hasVercelOidcEnvVar: false, hasCredentialsJson: true, ... }
```

También se mejoró el mensaje de error para el caso `invalid_rapt` (credenciales OAuth2 de usuario expiradas), reemplazando el JSON crudo de Google por un mensaje legible y accionable.

Estos logs permitieron confirmar que **la app nunca había usado Workload Identity Federation en producción** — siempre caía al fallback de `GOOGLE_CREDENTIALS_JSON`, que son credenciales personales que Google invalida cada cierto tiempo mediante un mecanismo llamado RAPT (Reauth Proof Token).

---

## Cambio 3 — Autenticación Permanente con Google Cloud

**Commit:** `777ea8a`
**Archivos modificados:** `src/app/api/vertex/config/route.ts`, `package.json`, `package-lock.json`
**Impacto:** Elimina para siempre el error `invalid_rapt`. Las credenciales ya no expiran.

### El Problema Raíz

El código asumía que `process.env.VERCEL_OIDC_TOKEN` estaría disponible como variable de entorno en el runtime de las funciones serverless. En la práctica, **Vercel no inyecta esta variable de forma confiable**, ni en Hobby ni en Pro plan. El flujo de autenticación siempre caía al fallback de `GOOGLE_CREDENTIALS_JSON`.

`GOOGLE_CREDENTIALS_JSON` contiene credenciales de usuario OAuth2 (generadas con `gcloud auth application-default login`). Google las invalida periódicamente cuando detecta que no ha habido actividad de re-autenticación interactiva — lo cual es imposible en un servidor. Esto producía el error `invalid_rapt` y requería actualizar la variable manualmente cada pocos días.

### La Solución

Se reemplazó la dependencia en `process.env.VERCEL_OIDC_TOKEN` por el uso del helper oficial de Vercel:

```typescript
import { getVercelOidcToken } from '@vercel/functions/oidc'

const oidcToken = await getVercelOidcToken()
```

`getVercelOidcToken()` obtiene el token vía la API interna de Vercel, sin depender de variables de entorno. Con este token, el flujo de autenticación es:

```
Vercel OIDC Token
  → GCP Security Token Service (intercambio)
  → Federated Token (identidad Vercel)
  → Service Account Impersonation (salesvoice-vertexai@...)
  → Access Token de Google Cloud (válido 1 hora, se renueva automáticamente)
```

Este mecanismo se llama **Workload Identity Federation (WIF)**. No hay credenciales estáticas, no hay secretos que rotar, no hay expiraciones manuales.

El orden de intentos quedó así:

1. `getVercelOidcToken()` — método oficial, siempre funciona en Vercel
2. `process.env.VERCEL_OIDC_TOKEN` — fallback legacy
3. `GOOGLE_CREDENTIALS_JSON` / ADC — last resort para desarrollo local

**Confirmación en logs de producción** (mismo día, tras el deploy):

```
[vertex/config] OIDC token obtained via getVercelOidcToken()
[vertex/config] auth path: wif_helper
responseStatusCode: 200
```

---

## Estado Actual de la App

| Componente | Estado |
|---|---|
| Vertex AI Live API (WebSocket) | Funcionando con WIF, sin expiraciones |
| Captura de audio en iOS Safari | Funcionando (resampling manual a 16 kHz) |
| Captura de audio en Android Chrome | Funcionando |
| Playback de audio en móvil | Funcionando (sin sampleRate forzado) |
| Mensajes de error al usuario | Implementados (permiso, HTTPS, mic ocupado, etc.) |
| Deploy activo | `voice-jade.vercel.app` en Vercel Pro |

---

## Recomendaciones para Producción Real

Las siguientes tareas son necesarias antes de abrir la app a usuarios reales. Se presentan por prioridad.

### Crítico — Seguridad y Costos

**1. Validar autenticación en `/api/vertex/config`**

Actualmente, cualquier persona que conozca la URL del endpoint puede hacer una petición GET y recibir un access token válido de Google Cloud, sin necesidad de estar autenticada en la app. Un atacante podría usar ese token para consumir cuota de Vertex AI de forma arbitraria.

La corrección es simple: leer la sesión de Supabase desde el servidor antes de emitir el token.

```typescript
// Agregar al inicio del GET handler:
const supabase = await createServerClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) {
  return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
}
```

**2. Rate limiting en endpoints de IA**

Los endpoints `/api/vertex/config` y `/api/evaluate` hacen llamadas a modelos de IA. Sin rate limiting, un usuario (o bot) puede lanzar decenas de llamadas por minuto y agotar la cuota o disparar la factura.

Solución recomendada: **Upstash Redis** (tiene plan gratuito, integración directa con Vercel).

```typescript
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '1 m'),  // 10 llamadas por minuto por usuario
})

const { success } = await ratelimit.limit(user.id)
if (!success) return NextResponse.json({ error: 'Límite alcanzado' }, { status: 429 })
```

**3. Alertas de billing en Google Cloud**

En GCP → Billing → Budgets & Alerts, configurar una alerta de email cuando el gasto mensual supere $50 y otra a $100. El modelo `gemini-live-2.5-flash` cuesta ~$0.04/min de conversación; 2,500 minutos al mes activan la primera alerta.

**4. Eliminar `GOOGLE_CREDENTIALS_JSON` de Vercel**

Con WIF ya funcionando, esta variable ya no es necesaria. Contiene credenciales personales de un usuario de Google y no debería estar en un servidor de producción. Se puede eliminar desde Vercel → Project Settings → Environment Variables.

---

### Importante — Antes de Escalar

**5. Cuota por usuario en base de datos**

Limitar el número de llamadas diarias por usuario directamente en Supabase, sin depender solo del rate limiting en la API. Esto da control granular y permite tiers (usuarios gratuitos vs. premium).

**6. Error tracking (Sentry o similar)**

Los `console.error` en funciones serverless de Vercel solo persisten ~24 horas en los logs. Para producción real se necesita un sistema de alertas que notifique cuando algo falla. Sentry tiene plan gratuito y se integra con Next.js en 5 minutos.

**7. Cumplimiento legal (voz + datos)**

La app captura voz del usuario, la envía a Google Cloud (Gemini), y guarda la transcripción en Supabase. Antes de tener usuarios reales se necesita:
- Política de Privacidad que describa qué datos se recopilan y dónde se procesan.
- Términos de Uso.
- Si hay usuarios en la Unión Europea: cumplimiento GDPR (consentimiento explícito para procesar voz).

---

### Nice-to-Have — Deuda Técnica

**8. Migrar `ScriptProcessorNode` → `AudioWorkletNode`**

`ScriptProcessorNode` está marcado como deprecated en la especificación Web Audio API y genera advertencias en la consola del navegador. La migración a `AudioWorkletNode` mejora el rendimiento de audio en dispositivos de gama baja y elimina los warnings, pero no es urgente.

**9. WebSocket reconnect con backoff exponencial**

Si la conexión a Gemini se cae a mitad de una llamada (lo cual puede ocurrir por inestabilidad de red en móvil), el usuario recibe un error genérico. Implementar reintentos automáticos con backoff exponencial (1s → 2s → 4s → 8s, máx. 5 intentos) mejoraría significativamente la experiencia en redes móviles.

**10. Índices en Supabase**

Las queries de historial y rankings no tienen índices óptimos. Con pocos usuarios no se nota, pero cuando la tabla `sessions` supere los 10.000 registros, las consultas se volverán lentas. Agregar:

```sql
CREATE INDEX idx_sessions_user_created ON sessions(user_id, created_at DESC);
CREATE INDEX idx_rankings_score ON rankings(total_score DESC);
```

**11. Botón de Mute funcional**

El botón de mute en la interfaz de llamada actualmente solo cambia el ícono visualmente, pero no silencia el micrófono. El audio sigue enviándose a Gemini. Para silenciarlo realmente se debe pausar el `ScriptProcessorNode` o detener los tracks del `MediaStream`.

**12. Tests E2E con Playwright**

El flujo crítico (login → seleccionar tipo → iniciar llamada → finalizar → ver feedback) no tiene tests automatizados. Un test E2E básico con Playwright capturaría regresiones antes de hacer deploy.

---

## Arquitectura de Autenticación (Estado Final)

```
Usuario en Vercel
       │
       ▼
/api/vertex/config (GET)
       │
       ├── getVercelOidcToken()    ← helper oficial @vercel/functions
       │         │
       │         ▼
       │    GCP STS (token exchange)
       │         │
       │         ▼
       │    Service Account Impersonation
       │         │
       │         ▼
       │    Access Token (válido 1h, auto-renovable)
       │
       ├── fallback: VERCEL_OIDC_TOKEN (env var)
       │
       └── fallback: GOOGLE_CREDENTIALS_JSON / ADC (solo local)
```

---

*Documento generado el 27/04/2026. Contacto técnico: adversoagencia@gmail.com*
