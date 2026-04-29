/**
 * Validación de variables de entorno requeridas.
 * Se ejecuta al importar este módulo — si falta alguna, el error explota
 * en tiempo de arranque del servidor (no en medio de un request).
 *
 * Importar desde src/app/layout.tsx para que corra en cada boot.
 */

const REQUIRED_SERVER_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'GEMINI_API_KEY',
] as const

// Solo validamos en el servidor (este módulo puede importarse desde Server Components)
if (typeof window === 'undefined') {
  const missing = REQUIRED_SERVER_VARS.filter((key) => !process.env[key])
  if (missing.length > 0) {
    throw new Error(
      `[env] Faltan variables de entorno requeridas: ${missing.join(', ')}\n` +
      'Copia .env.local.example a .env.local y rellena los valores.'
    )
  }
}

export const env = {
  supabaseUrl:     process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  geminiApiKey:    process.env.GEMINI_API_KEY!,
  vertexProjectId: process.env.VERTEX_AI_PROJECT_ID,
  vertexLocation:  process.env.VERTEX_AI_LOCATION ?? 'us-central1',
} as const
