import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// /api/admin/students/[id] — detalle de un alumno (GET) o cambio de rol (PATCH).
// Mismo patrón de seguridad en ambos métodos: los RPCs son SECURITY DEFINER y
// verifican is_admin() internamente.

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

// PATCH /api/admin/students/[id]  body: { role: 'alumno' | 'instructor' | 'admin' }
// Cambia el rol del usuario. El RPC valida admin + rol válido + no auto-modificación.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const role = body?.role

    if (!role || typeof role !== 'string') {
      return NextResponse.json({ error: 'Missing role in body' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabase.rpc('admin_update_user_role', {
      p_user_id: id,
      p_role: role,
    })

    if (error) {
      const msg = error.message?.toLowerCase() || ''
      const isForbidden = msg.includes('forbidden')
      const isSelfMod  = msg.includes('cannot change your own')
      const isNotFound = msg.includes('user not found')
      const isInvalid  = msg.includes('invalid role')

      const status =
        isForbidden ? 403 :
        isSelfMod  ? 400 :
        isNotFound ? 404 :
        isInvalid  ? 400 :
        500

      console.error('[api/admin/students/:id PATCH] rpc failed', error)
      return NextResponse.json({ error: error.message }, { status })
    }

    return NextResponse.json({ user: data })
  } catch (err) {
    console.error('[api/admin/students/:id PATCH] exception', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error updating role' },
      { status: 500 }
    )
  }
}
