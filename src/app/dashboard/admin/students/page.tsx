'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useUserRole } from '@/lib/hooks/use-user-role'

interface Student {
  id: string
  email: string
  name: string
  role: 'alumno' | 'instructor' | 'admin'
  created_at: string
  sessions_count: number
  avg_score: number
  total_score: number
  rank: number
  badges: string[]
  last_session_at: string | null
}

const ROLE_BADGE: Record<string, string> = {
  admin: 'bg-red-500/20 text-red-400',
  instructor: 'bg-purple-500/20 text-purple-400',
  alumno: 'bg-blue-500/20 text-blue-400',
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Nunca'
  return new Date(iso).toLocaleDateString('es-MX', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function scoreColor(score: number): string {
  if (score === 0) return 'text-zinc-500'
  if (score >= 80) return 'text-green-400'
  if (score >= 60) return 'text-blue-400'
  if (score >= 40) return 'text-yellow-400'
  return 'text-red-400'
}

export default function AdminStudentsPage() {
  const router = useRouter()
  const { isAdmin, loading: roleLoading } = useUserRole()
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'todos' | 'alumno' | 'instructor' | 'admin'>('todos')

  // Gate de UI: si terminó de cargar el rol y no es admin, lo sacamos.
  // (El API también lo bloquea, este es solo UX.)
  useEffect(() => {
    if (!roleLoading && !isAdmin) {
      router.replace('/dashboard')
    }
  }, [roleLoading, isAdmin, router])

  useEffect(() => {
    if (!isAdmin) return
    fetch('/api/admin/students')
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Error cargando alumnos')
        }
        return res.json()
      })
      .then((data) => setStudents(data.students ?? []))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [isAdmin])

  if (roleLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-blue-500" />
      </div>
    )
  }

  if (!isAdmin) return null

  const filtered = students.filter((s) => {
    if (roleFilter !== 'todos' && s.role !== roleFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!s.name.toLowerCase().includes(q) && !s.email.toLowerCase().includes(q)) return false
    }
    return true
  })

  const totalSessions = students.reduce((acc, s) => acc + s.sessions_count, 0)
  const activeStudents = students.filter((s) => s.sessions_count > 0).length

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Panel de administración</h1>
        <p className="text-zinc-400 mt-1">Gestiona y supervisa el progreso de tus alumnos</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Total de usuarios</p>
          <p className="text-3xl font-bold text-white mt-1">{students.length}</p>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Activos</p>
          <p className="text-3xl font-bold text-white mt-1">{activeStudents}</p>
          <p className="text-xs text-zinc-500 mt-1">con al menos 1 sesión</p>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Sesiones totales</p>
          <p className="text-3xl font-bold text-white mt-1">{totalSessions}</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          placeholder="Buscar por nombre o email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-zinc-900/50 border border-zinc-800 rounded-lg px-4 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
        />
        <div className="flex gap-2">
          {(['todos', 'alumno', 'instructor', 'admin'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRoleFilter(r)}
              className={`px-3 py-2 rounded-lg text-xs font-medium capitalize transition-colors ${
                roleFilter === r
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              {r === 'todos' ? 'Todos' : r}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-8 text-center">
          <p className="text-zinc-400">No hay usuarios que coincidan con los filtros.</p>
        </div>
      ) : (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-950/40 border-b border-zinc-800">
                <tr className="text-left text-xs text-zinc-500 uppercase tracking-wide">
                  <th className="px-4 py-3 font-medium">Usuario</th>
                  <th className="px-4 py-3 font-medium">Rol</th>
                  <th className="px-4 py-3 font-medium text-right">Sesiones</th>
                  <th className="px-4 py-3 font-medium text-right">Promedio</th>
                  <th className="px-4 py-3 font-medium text-right">Badges</th>
                  <th className="px-4 py-3 font-medium">Última actividad</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-zinc-700 flex items-center justify-center text-sm font-medium text-zinc-300 shrink-0">
                          {s.name?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div className="min-w-0">
                          <p className="text-white font-medium truncate">{s.name}</p>
                          <p className="text-xs text-zinc-500 truncate">{s.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium uppercase ${ROLE_BADGE[s.role]}`}>
                        {s.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-300 font-medium">{s.sessions_count}</td>
                    <td className={`px-4 py-3 text-right font-bold ${scoreColor(Number(s.avg_score))}`}>
                      {s.sessions_count > 0 ? Number(s.avg_score).toFixed(1) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-300">
                      {Array.isArray(s.badges) ? s.badges.length : 0}/10
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">{formatDate(s.last_session_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/dashboard/admin/students/${s.id}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300"
                      >
                        Ver detalle
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
