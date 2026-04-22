import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  // Incluir /api/* asegura que el access token de Supabase se refresque antes de que
  // las API routes intenten leer `user`. Sin esto, después de ~1h las rutas como
  // /api/sessions devuelven 401 aunque el navegador aún tenga cookies.
  matcher: ['/dashboard/:path*', '/login', '/register', '/api/:path*'],
}
