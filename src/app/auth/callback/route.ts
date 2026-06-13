import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  // Sanitizar parámetro `next`: solo rutas internas relativas para prevenir open redirect.
  // Rechazamos cualquier cosa con `://` (URLs absolutas) o `//` (protocol-relative).
  const rawNext = searchParams.get('next') ?? '/dashboard'
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') && !rawNext.includes('://')
    ? rawNext
    : '/dashboard'

  const supabase = await createClient()

  // PKCE flow (código de autorización)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Implicit flow (token_hash) — usado por emails de recuperación de contraseña
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as 'recovery' | 'signup' | 'invite' | 'magiclink' | 'email',
    })
    if (!error) {
      const destination = type === 'recovery' ? '/reset-password' : next
      return NextResponse.redirect(`${origin}${destination}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
