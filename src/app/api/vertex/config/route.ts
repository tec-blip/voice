import { NextResponse } from 'next/server'
import { GoogleAuth } from 'google-auth-library'
import { getVercelOidcToken } from '@vercel/functions/oidc'

export const dynamic = 'force-dynamic'

const PROJECT  = process.env.VERTEX_AI_PROJECT_ID
const LOCATION = process.env.VERTEX_AI_LOCATION ?? 'us-central1'
const MODEL    = process.env.VERTEX_AI_MODEL    ?? 'gemini-live-2.5-flash-native-audio'

// Workload Identity Federation — valores del pool creado en GCP
const WIF_AUDIENCE =
  '//iam.googleapis.com/projects/947812330851/locations/global/workloadIdentityPools/vercel-pool/providers/vercel-provider'
const WIF_SERVICE_ACCOUNT_URL =
  'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' +
  'salesvoice-vertexai@ethereal-audio-494220-t6.iam.gserviceaccount.com:generateAccessToken'

async function getTokenViaWorkloadIdentity(oidcToken: string): Promise<string> {
  // Paso 1: intercambiar el OIDC token de Vercel por un federated token de GCP STS
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
  if (!stsRes.ok) {
    const err = await stsRes.text()
    throw new Error(`STS token exchange falló: ${err}`)
  }
  const { access_token: federatedToken } = await stsRes.json()

  // Paso 2: suplantar el service account para obtener el access token final
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
  if (!impersonateRes.ok) {
    const err = await impersonateRes.text()
    throw new Error(`Impersonación del service account falló: ${err}`)
  }
  const json = await impersonateRes.json() as { accessToken: string; expireTime?: string }
  if (json.expireTime) {
    const expiresInSeconds = Math.round((new Date(json.expireTime).getTime() - Date.now()) / 1000)
    console.log(`[vertex/config] access token expires in ${expiresInSeconds}s (at ${json.expireTime})`)
  }
  return json.accessToken
}

export async function GET() {
  if (!PROJECT) {
    return NextResponse.json(
      { error: 'VERTEX_AI_PROJECT_ID no está configurado' },
      { status: 500 },
    )
  }

  try {
    let token: string
    let authPath: 'wif_helper' | 'wif_envvar' | 'credentials_json' | 'adc' = 'adc'

    // Intento 1: helper oficial @vercel/functions/oidc (recomendado en Pro/Enterprise)
    let oidcToken: string | undefined
    try {
      oidcToken = await getVercelOidcToken()
      if (oidcToken) {
        authPath = 'wif_helper'
        console.log('[vertex/config] OIDC token obtained via getVercelOidcToken()')
      }
    } catch (helperErr) {
      // El helper falla cuando no está habilitado o cuando se ejecuta fuera de Vercel.
      console.log(
        '[vertex/config] getVercelOidcToken() not available:',
        helperErr instanceof Error ? helperErr.message : String(helperErr),
      )
    }

    // Intento 2: env var directa (legacy / fallback)
    if (!oidcToken && process.env.VERCEL_OIDC_TOKEN) {
      oidcToken = process.env.VERCEL_OIDC_TOKEN
      authPath = 'wif_envvar'
      console.log('[vertex/config] OIDC token obtained via process.env.VERCEL_OIDC_TOKEN')
    }

    if (oidcToken) {
      // Producción (Vercel): Workload Identity Federation — sin credenciales personales
      console.log(`[vertex/config] auth path: ${authPath}`)
      token = await getTokenViaWorkloadIdentity(oidcToken)
    } else {
      // Fallback: GOOGLE_CREDENTIALS_JSON (Vercel temporal) o ADC (local)
      authPath = process.env.GOOGLE_CREDENTIALS_JSON ? 'credentials_json' : 'adc'
      console.log(`[vertex/config] auth path: ${authPath} (no OIDC token disponible)`)
      const authOptions: ConstructorParameters<typeof GoogleAuth>[0] = {
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      }
      if (process.env.GOOGLE_CREDENTIALS_JSON) {
        authOptions.credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON)
      }
      const auth = new GoogleAuth(authOptions)
      const client = await auth.getClient()
      const result = await client.getAccessToken()
      if (!result.token) throw new Error('No se obtuvo token — ejecuta: gcloud auth application-default login')
      token = result.token
    }
    console.log(`[vertex/config] token obtained via ${authPath}`)

    const wsUrl =
      `wss://${LOCATION}-aiplatform.googleapis.com/ws/` +
      `google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent` +
      `?access_token=${encodeURIComponent(token)}`

    const modelPath =
      `projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}`

    return NextResponse.json({ wsUrl, modelPath })
  } catch (err) {
    console.error('[vertex/config] FAILED', {
      message: err instanceof Error ? err.message : String(err),
      hasVercelOidcEnvVar: !!process.env.VERCEL_OIDC_TOKEN,
      hasCredentialsJson: !!process.env.GOOGLE_CREDENTIALS_JSON,
      project: PROJECT,
      runtime: process.env.VERCEL ? 'vercel' : 'local',
    })
    const rawMessage = err instanceof Error ? err.message : 'Error desconocido'

    // Detectar el caso específico de credenciales user-OAuth2 expiradas (rapt)
    // y dar un mensaje accionable en lugar del JSON crudo de Google.
    if (rawMessage.includes('invalid_rapt') || rawMessage.includes('reauth')) {
      return NextResponse.json(
        {
          error:
            'Credenciales de Google expiradas. El admin debe activar Vercel OIDC Federation o refrescar GOOGLE_CREDENTIALS_JSON.',
        },
        { status: 500 },
      )
    }
    return NextResponse.json({ error: rawMessage }, { status: 500 })
  }
}
