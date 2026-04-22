import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// /api/admin/students/[id] — detalle de un alumno: perfil, ranking, sesiones
// (con transcript y feedback completos). Mismo patrón de seguridad: RPC
// SECURITY DEFINER que verifica admin internamente.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabase.rpc('get_student_detail', {
      p_student_id: id,
    })

    if (error) {
      const isForbidden = error.message?.toLowerCase().includes('forbidden')
      console.error('[api/admin/students/:id] rpc failed', error)
      return NextResponse.json(
        { error: isForbidden ? 'Forbidden — admin role required' : error.message },
        { status: isForbidden ? 403 : 500 }
      )
    }

    if (!data || !data.user) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 })
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error('[api/admin/students/:id] exception', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error fetching student' },
      { status: 500 }
    )
  }
}
