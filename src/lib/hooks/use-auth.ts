import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { clearRoleCache } from '@/lib/hooks/use-user-role'
import type { User } from '@supabase/supabase-js'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    clearRoleCache()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return { user, loading, signOut }
}
