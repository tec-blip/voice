import { NextResponse } from 'next/server'
import { GoogleAuth } from 'google-auth-library'

export const dynamic = 'force-dynamic'

const PROJECT  = process.env.VERTEX_AI_PROJECT_ID
const LOCATION = process.env.VERTEX_AI_LOCATION ?? 'us-central1'
const MODEL    = process.env.VERTEX_AI_MODEL    ?? 'gemini-2.0-flash-live-preview-04-09'

export async function GET() {
  if (!PROJECT) {
    return NextResponse.json(
      { error: 'VERTEX_AI_PROJECT_ID no está configurado en .env.local' },
      { status: 500 },
    )
  }

  try {
    // En Vercel: usa GOOGLE_CREDENTIALS_JSON (JSON del service account o user credentials)
    // En local:  usa ADC automáticamente (gcloud auth application-default login)
    const authOptions: ConstructorParameters<typeof GoogleAuth>[0] = {
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    }
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
      authOptions.credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON)
    }
    const auth = new GoogleAuth(authOptions)
    const client = await auth.getClient()
    const { token } = await client.getAccessToken()

    if (!token) throw new Error('ADC no devolvió token — ejecuta: gcloud auth application-default login')

    const wsUrl =
      `wss://${LOCATION}-aiplatform.googleapis.com/ws/` +
      `google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent` +
      `?access_token=${encodeURIComponent(token)}`

    const modelPath =
      `projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}`

    return NextResponse.json({ wsUrl, modelPath })
  } catch (err) {
    console.error('[vertex/config]', err)
    const message = err instanceof Error ? err.message : 'Error desconocido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
