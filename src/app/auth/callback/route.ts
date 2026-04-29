import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // Sanitizar parámetro `next`: solo rutas internas relativas para prevenir open redirect.
  // Rechazamos cualquier cosa con `://` (URLs absolutas) o `//` (protocol-relative).
  const rawNext = searchParams.get('next') ?? '/dashboard'
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') && !rawNext.includes('://')
    ? rawNext
    : '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
