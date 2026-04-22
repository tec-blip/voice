import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// /api/admin/students — lista de todos los alumnos con sus stats agregadas.
// Llama al RPC SECURITY DEFINER `get_students_overview` que internamente
// verifica que el caller sea admin antes de devolver datos. Si no es admin,
// el RPC lanza excepción y aquí devolvemos 403.
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabase.rpc('get_students_overview')

    if (error) {
      // Si la función rechaza por no ser admin viene como error de Postgres.
      const isForbidden = error.message?.toLowerCase().includes('forbidden')
      console.error('[api/admin/students] rpc failed', error)
      return NextResponse.json(
        { error: isForbidden ? 'Forbidden — admin role required' : error.message },
        { status: isForbidden ? 403 : 500 }
      )
    }

    return NextResponse.json({ students: data ?? [] })
  } catch (err) {
    console.error('[api/admin/students] exception', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error listing students' },
      { status: 500 }
    )
  }
}
