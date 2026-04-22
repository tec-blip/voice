import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Solo mostramos a usuarios que han completado al menos 1 sesión.
  // Los que nunca han practicado tienen rank=0 en DB (así los asigna
  // `update_ranking`) — si los incluyéramos con ORDER BY rank ASC
  // aparecerían antes que los de rank=1, robándose la medalla de oro.
  const { data, error } = await supabase
    .from('rankings')
    .select('user_id, total_score, avg_score, sessions_count, rank, badges')
    .gt('sessions_count', 0)
    .order('rank', { ascending: true })
    .limit(50)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const userIds = data.map((r) => r.user_id)

  // Usamos un RPC SECURITY DEFINER porque la policy de users solo permite leer
  // la propia fila. Sin esto, todos los usuarios del ranking se verían como "Usuario".
  const { data: users, error: namesErr } = await supabase.rpc('get_user_names', {
    p_ids: userIds,
  })

  if (namesErr) {
    console.error('[api/rankings] get_user_names failed', namesErr)
  }

  const nameMap = new Map(
    (users as { id: string; name: string }[] | null)?.map((u) => [u.id, u.name]) || []
  )
  const enriched = data.map((r) => ({
    ...r,
    name: nameMap.get(r.user_id) || 'Usuario',
  }))

  return NextResponse.json({ rankings: enriched, currentUserId: user.id })
}
