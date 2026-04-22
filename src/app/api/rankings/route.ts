import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('rankings')
    .select('user_id, total_score, avg_score, sessions_count, rank, badges')
    .order('rank', { ascending: true })
    .limit(50)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const userIds = data.map((r) => r.user_id)
  const { data: users } = await supabase
    .from('users')
    .select('id, name')
    .in('id', userIds)

  const nameMap = new Map(users?.map((u) => [u.id, u.name]) || [])
  const enriched = data.map((r) => ({
    ...r,
    name: nameMap.get(r.user_id) || 'Usuario',
  }))

  return NextResponse.json({ rankings: enriched, currentUserId: user.id })
}
