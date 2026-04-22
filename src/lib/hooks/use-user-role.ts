import { useEffect, useSyncExternalStore } from 'react'

export type UserRole = 'alumno' | 'instructor' | 'admin'

interface MeResponse {
  id: string
  email: string
  name: string
  role: UserRole
}

// Store externo simple: un valor + lista de listeners. Lo usamos vía
// useSyncExternalStore para evitar setState dentro de useEffect (anti-pattern
// que React 19 / Next 16 lintean). Esto además garantiza que cuando un
// componente dispara el fetch, todos los demás componentes que usan el hook
// se actualizan automáticamente cuando llega la respuesta.
let cachedRole: UserRole | null = null
let inFlight: Promise<UserRole | null> | null = null
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): UserRole | null {
  return cachedRole
}

// Server-side: no hay rol disponible (este hook es client-only).
function getServerSnapshot(): UserRole | null {
  return null
}

async function fetchRole(): Promise<UserRole | null> {
  if (cachedRole) return cachedRole
  if (inFlight) return inFlight

  inFlight = fetch('/api/me')
    .then((res) => (res.ok ? res.json() : null))
    .then((data: MeResponse | null) => {
      const role = data?.role ?? null
      if (role) {
        cachedRole = role
        notify()
      }
      return role
    })
    .catch(() => null)
    .finally(() => {
      inFlight = null
    })

  return inFlight
}

export function useUserRole() {
  const role = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  useEffect(() => {
    // Disparamos el fetch si aún no tenemos el rol. Si otro componente ya lo
    // está pidiendo, fetchRole reutiliza el inFlight promise.
    if (cachedRole === null) {
      fetchRole()
    }
  }, [])

  return {
    role,
    loading: role === null,
    isAdmin: role === 'admin',
    isInstructor: role === 'instructor' || role === 'admin',
  }
}

// Útil para limpiar el caché en signOut.
export function clearRoleCache() {
  cachedRole = null
  inFlight = null
  notify()
}
