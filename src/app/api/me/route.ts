import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// /api/me — devuelve la info del usuario autenticado incluyendo su rol.
// Lo usamos del lado cliente (sidebar, gates de UI) para saber si mostrar
// la sección de Admin sin tener que hacer joins manuales contra Supabase.
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabase
      .from('users')
      .select('id, email, name, role, avatar_url, created_at')
      .eq('id', user.id)
      .maybeSingle()

    if (error) {
      console.error('[api/me] query failed', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data) {
      // El trigger handle_new_user no corrió (raro). Devolvemos lo mínimo del JWT.
      return NextResponse.json({
        id: user.id,
        email: user.email,
        name: user.user_metadata?.name ?? null,
        role: 'alumno',
      })
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error('[api/me] exception', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error fetching user' },
      { status: 500 }
    )
  }
}
