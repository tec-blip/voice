# Resumen Técnico: Migración Google AI Studio → Vertex AI Live

## Contexto
SalesVoice V1 (simulador de llamadas de ventas con IA) requería pasar de Google AI Studio (`generativelanguage.googleapis.com`) a **Vertex AI Live API** (`aiplatform.googleapis.com`) para:
- **Reducir costos**: ~$0.04/min vs $0.12-0.18/min con otras plataformas
- **Mantener bidireccionalidad en tiempo real**: WebSocket nativo con audio Float32↔Int16↔base64
- **Modelo actualizado**: `gemini-live-2.5-flash-native-audio` (GA, reemplaza preview)

---

## Cambios Implementados

### 1. **Backend: Token OAuth2 + Workload Identity Federation**

**Archivo**: `src/app/api/vertex/config/route.ts` (nuevo)

- **3-tier auth fallback**:
  1. **Producción (Vercel)**: Workload Identity Federation
     - `VERCEL_OIDC_TOKEN` → GCP STS → Service account impersonation
     - Sin credenciales personales almacenadas
  2. **Fallback**: `GOOGLE_CREDENTIALS_JSON` (user OAuth2 con ADC)
  3. **Fallback local**: `gcloud auth application-default login`

- **Implementación**:
  ```typescript
  async function getTokenViaWorkloadIdentity(oidcToken: string): Promise<string> {
    // Paso 1: intercambiar OIDC token de Vercel por federated token de GCP STS
    const stsRes = await fetch('https://sts.googleapis.com/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        audience: WIF_AUDIENCE,
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        subject_token: oidcToken,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
      }),
    })
    const { access_token: federatedToken } = await stsRes.json()
    
    // Paso 2: suplantar service account para obtener access token final
    const impersonateRes = await fetch(WIF_SERVICE_ACCOUNT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${federatedToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        scope: ['https://www.googleapis.com/auth/cloud-platform'],
        lifetime: '3600s',
      }),
    })
    const { accessToken } = await impersonateRes.json()
    return accessToken
  }
  ```

- **Respuesta**: `{ wsUrl, modelPath }` para que el cliente se conecte

---

### 2. **Frontend: Actualizar WebSocket a Vertex AI**

**Archivo**: `src/lib/hooks/use-gemini-live.ts` (modificado)

**Cambios clave**:
- Fetch a `/api/vertex/config` en lugar de `/api/gemini/config`
- **Modelo dinámico**: `modelPathRef` almacena `projects/{PROJECT}/locations/{LOCATION}/publishers/google/models/{MODEL}`
- **Remover `languageCode`**: Modelo nativo de audio no lo soporta (causa inestabilidad)
- **`sessionResumption` condicional**: Solo enviar cuando hay handle real, no `{}` en sesiones nuevas

```typescript
const { wsUrl, modelPath } = await fetch('/api/vertex/config').then(r => r.json())
modelPathRef.current = modelPath

// Mensaje de setup:
{
  model: modelPathRef.current,
  generationConfig: {
    responseModalities: ['AUDIO'],
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName } },
      // languageCode removido
    }
  },
  ...(isResuming && sessionHandleRef.current 
    ? { sessionResumption: { handle: sessionHandleRef.current } }
    : {})
}
```

---

### 3. **Mejorar Agente de Roleplay**

**Archivo**: `src/lib/prompts/roleplay.ts` (mejorado)

**Problemas**: Cuelgues prematuros, fases demasiado rápidas, falta de conversación natural

**Soluciones**:
- Sección **RITMO Y FLUJO** (antes de reacciones de metodología):
  - Gradualidad: 2-3 intercambios mínimo antes de cambio de actitud
  - Conversación natural sin prisa por avanzar fases
  - No predecible: si el closer "chequea casillas", se percibe y mantiene defensas
  
- **TIMEOUT** tightened: Requiere 8+ minutos AND conversación circular (no solo timeout)
- **NO cuelgues**: Mínimo 5 minutos (antes 3), no colgar en silencios

---

### 4. **Configuración GCP**

**Proyecto**: `ethereal-audio-494220-t6` (project number: `947812330851`)

**Setup**:
- **WIF Pool**: `vercel-pool` con provider `vercel-provider`
- **Issuer**: `https://oidc.vercel.com/tec-blips-projects`
- **Service Account**: `salesvoice-vertexai@ethereal-audio-494220-t6.iam.gserviceaccount.com`
  - Rol: `roles/iam.serviceAccountTokenCreator`
  - Bindings de WIF configurados (Vercel OIDC claims mapeados)

**Variables de Entorno** (`.env.local` y Vercel):
```
VERTEX_AI_PROJECT_ID=ethereal-audio-494220-t6
VERTEX_AI_LOCATION=us-central1
VERTEX_AI_MODEL=gemini-live-2.5-flash-native-audio
VERCEL_OIDC_TOKEN=<auto-injected by Vercel>
GOOGLE_CREDENTIALS_JSON=<user ADC, fallback>
```

---

## Problemas Encontrados & Soluciones

| Problema | Causa | Solución |
|----------|-------|----------|
| BSOD en dev | Turbopack GPU crash (NVIDIA RTX 3050) | `npm run build && npm start` |
| Wrong project ID | Typo `i6` vs `t6` | Verificar con `gcloud projects list` |
| Wrong model name | Google AI Studio vs Vertex naming | `gemini-live-2.5-flash-native-audio` |
| API version error | Endpoint `v1beta1` vs `v1` | Cambiar a `v1` |
| Inestabilidad/cuelgues | `languageCode: 'es-MX'` no soportado | Remover de speechConfig |
| `sessionResumption: {}` | Causaba confusión en setup | Enviar solo con handle real |
| Premature `end_call` | Combinación languageCode bug + reglas TIMEOUT laxas | Arreglar ambos |
| `invalid_rapt` error en Vercel | GOOGLE_CREDENTIALS_JSON (user OAuth2) expirado | Activar VERCEL_OIDC_TOKEN o refrescar ADC |

---

## Estado Actual

✅ **Implementado**:
- Vertex AI Live API integrado (WebSocket bidireccional)
- OAuth2 con 3 niveles de fallback
- Workload Identity Federation configurado
- Agente de roleplay mejorado (natural pacing)
- Deploy en Vercel (`voice-jade.vercel.app`)

⏳ **Pendiente**:
- Activar `VERCEL_OIDC_TOKEN` en Vercel Security → OIDC Federation (click "Save")
- O refrescar `GOOGLE_CREDENTIALS_JSON` si WIF no está listo
- Testing de carga (múltiples llamadas simultáneas)

---

## Arquitectura Resumida

```
Cliente (Next.js)
    ↓
/api/vertex/config (GET)
    ├→ VERCEL_OIDC_TOKEN + WIF (producción)
    ├→ GOOGLE_CREDENTIALS_JSON (fallback)
    └→ ADC (local dev)
    ↓ returns { wsUrl, modelPath }
    ↓
Vertex AI WebSocket
    ├→ Gemini Live 2.5 Flash (native audio)
    └→ PCM bidireccional 16kHz/24kHz
```

---

## Archivos Modificados/Creados

- ✨ `src/app/api/vertex/config/route.ts` — Nuevo endpoint para obtener token + WebSocket URL
- 📝 `src/lib/hooks/use-gemini-live.ts` — Actualizar a Vertex AI + remover languageCode
- 📝 `src/lib/prompts/roleplay.ts` — Mejorar pacing y reglas de timeout
- ⚙️ `.env.local` — Variables VERTEX_AI_*

---

**Fecha de implementación**: Abril 2026  
**Estado**: En producción (Vercel), requiere activación de OIDC o fallback credentials
