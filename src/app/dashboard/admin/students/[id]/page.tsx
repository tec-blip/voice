'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/use-auth'
import { useUserRole, type UserRole } from '@/lib/hooks/use-user-role'

interface TranscriptEntry {
  role: 'user' | 'model'
  text: string
}

interface SessionRow {
  id: string
  type: string
  score: number | null
  duration: number | null
  transcript: TranscriptEntry[] | null
  feedback: {
    puntuacion_general: number
    feedback_positivo: string
    feedback_mejora: string
  } | null
  created_at: string
}

interface StudentDetail {
  user: {
    id: string
    email: string
    name: string
    role: 'alumno' | 'instructor' | 'admin'
    created_at: string
  }
  ranking: {
    sessions_count: number
    avg_score: number
    total_score: number
    rank: number
    badges: string[]
  } | null
  sessions: SessionRow[]
}

const TYPE_LABELS: Record<string, string> = {
  cierre: 'Cierre',
  llamada_fria: 'Llamada en frío',
  framing: 'Framing',
  objeciones: 'Objeciones',
  general: 'General',
}

const TYPE_COLORS: Record<string, string> = {
  cierre: 'bg-blue-500/20 text-blue-400',
  llamada_fria: 'bg-green-500/20 text-green-400',
  framing: 'bg-purple-500/20 text-purple-400',
  objeciones: 'bg-yellow-500/20 text-yellow-400',
  general: 'bg-zinc-500/20 text-zinc-400',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function scoreColor(score: number | null): string {
  if (score === null || score === 0) return 'text-zinc-500'
  if (score >= 80) return 'text-green-400'
  if (score >= 60) return 'text-blue-400'
  if (score >= 40) return 'text-yellow-400'
  return 'text-red-400'
}

export default function AdminStudentDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const { user: currentUser } = useAuth()
  const { isAdmin, loading: roleLoading } = useUserRole()
  const [data, setData] = useState<StudentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  // State para el selector de rol
  const [pendingRole, setPendingRole] = useState<UserRole | null>(null)
  const [savingRole, setSavingRole] = useState(false)
  const [roleMessage, setRoleMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    if (!roleLoading && !isAdmin) {
      router.replace('/dashboard')
    }
  }, [roleLoading, isAdmin, router])

  useEffect(() => {
    if (!isAdmin || !params?.id) return
    fetch(`/api/admin/students/${params.id}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Error cargando detalle del alumno')
        }
        return res.json()
      })
      .then((d: StudentDetail) => setData(d))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [isAdmin, params?.id])

  if (roleLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-blue-500" />
      </div>
    )
  }

  if (!isAdmin) return null

  if (error || !data) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <Link href="/dashboard/admin/students" className="text-sm text-zinc-400 hover:text-white inline-flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Volver a alumnos
        </Link>
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
          <p className="text-red-400 text-sm">{error || 'Alumno no encontrado'}</p>
        </div>
      </div>
    )
  }

  const { user, ranking, sessions } = data
  const sessionsCount = ranking?.sessions_count ?? 0
  const avgScore = ranking?.avg_score ?? 0
  const rank = ranking?.rank ?? 0
  const badges = Array.isArray(ranking?.badges) ? ranking!.badges : []

  const isSelf = currentUser?.id === user.id
  const selectedRole = pendingRole ?? user.role
  const hasChange = pendingRole !== null && pendingRole !== user.role

  async function saveRole() {
    if (!pendingRole || pendingRole === user.role) return
    setSavingRole(true)
    setRoleMessage(null)
    try {
      const res = await fetch(`/api/admin/students/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: pendingRole }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body.error || 'Error al cambiar el rol')
      }
      setData((prev) => (prev ? { ...prev, user: { ...prev.user, role: pendingRole } } : prev))
      setPendingRole(null)
      setRoleMessage({ kind: 'ok', text: `Rol actualizado a "${pendingRole}"` })
    } catch (err) {
      setRoleMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Error desconocido' })
    } finally {
      setSavingRole(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link href="/dashboard/admin/students" className="text-sm text-zinc-400 hover:text-white inline-flex items-center gap-1">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Volver a alumnos
      </Link>

      {/* Header del alumno */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-full bg-zinc-700 flex items-center justify-center text-2xl font-bold text-zinc-300">
            {user.name?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-white truncate">{user.name}</h1>
            <p className="text-sm text-zinc-400 truncate">{user.email}</p>
            <div className="flex gap-2 mt-1">
              <span className="text-xs text-zinc-500">Miembro desde {formatDate(user.created_at)}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium uppercase bg-zinc-800 text-zinc-400">
                {user.role}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Gestión de rol */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-white">Gestión de rol</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              {isSelf
                ? 'No puedes cambiar tu propio rol. Pide a otro admin que lo haga.'
                : 'Cambia el nivel de acceso de este usuario.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedRole}
              disabled={isSelf || savingRole}
              onChange={(e) => {
                setPendingRole(e.target.value as UserRole)
                setRoleMessage(null)
              }}
              className="bg-zinc-950/60 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <option value="alumno">Alumno</option>
              <option value="instructor">Instructor</option>
              <option value="admin">Admin</option>
            </select>
            <button
              onClick={saveRole}
              disabled={!hasChange || isSelf || savingRole}
              className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {savingRole ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
        {roleMessage && (
          <div className={`mt-3 text-xs ${roleMessage.kind === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
            {roleMessage.text}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Sesiones</p>
          <p className="text-2xl font-bold text-white mt-1">{sessionsCount}</p>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Promedio</p>
          <p className={`text-2xl font-bold mt-1 ${scoreColor(Number(avgScore))}`}>
            {sessionsCount > 0 ? Number(avgScore).toFixed(1) : '—'}
          </p>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Ranking</p>
          <p className="text-2xl font-bold text-white mt-1">{rank > 0 ? `#${rank}` : '—'}</p>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Badges</p>
          <p className="text-2xl font-bold text-white mt-1">{badges.length}/10</p>
        </div>
      </div>

      {/* Sesiones */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-3">Historial de sesiones</h2>
        {sessions.length === 0 ? (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-8 text-center">
            <p className="text-zinc-400">Este alumno aún no ha completado sesiones.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => (
              <div key={session.id} className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpanded(expanded === session.id ? null : session.id)}
                  className="w-full px-5 py-4 flex items-center justify-between hover:bg-zinc-800/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[session.type] || TYPE_COLORS.general}`}>
                      {TYPE_LABELS[session.type] || session.type}
                    </span>
                    <span className="text-xs text-zinc-500">{formatDuration(session.duration)}</span>
                    <span className="text-xs text-zinc-600">{formatDate(session.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-2xl font-bold ${scoreColor(session.score)}`}>
                      {session.score ?? '—'}
                    </span>
                    <svg className={`w-4 h-4 text-zinc-500 transition-transform ${expanded === session.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </div>
                </button>

                {expanded === session.id && (
                  <div className="px-5 pb-4 pt-0 border-t border-zinc-800/50 space-y-3">
                    {session.feedback && (
                      <>
                        <div className="bg-green-500/5 border border-green-500/10 rounded-lg p-3">
                          <p className="text-xs font-medium text-green-400 mb-1">Lo que hizo bien</p>
                          <p className="text-sm text-zinc-300 whitespace-pre-line">{session.feedback.feedback_positivo}</p>
                        </div>
                        <div className="bg-yellow-500/5 border border-yellow-500/10 rounded-lg p-3">
                          <p className="text-xs font-medium text-yellow-400 mb-1">Áreas de mejora</p>
                          <p className="text-sm text-zinc-300 whitespace-pre-line">{session.feedback.feedback_mejora}</p>
                        </div>
                      </>
                    )}

                    {session.transcript && session.transcript.length > 0 && (
                      <details className="bg-zinc-950/40 border border-zinc-800/60 rounded-lg overflow-hidden">
                        <summary className="px-3 py-2 cursor-pointer text-xs font-medium text-zinc-400 hover:text-zinc-300 flex items-center justify-between">
                          <span>Transcripción ({session.transcript.length} mensajes)</span>
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                          </svg>
                        </summary>
                        <div className="px-3 pb-3 pt-1 space-y-2 max-h-96 overflow-y-auto">
                          {session.transcript.map((entry, i) => (
                            <div key={i} className={`flex ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                              <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                                entry.role === 'user'
                                  ? 'bg-blue-600/20 text-blue-100'
                                  : 'bg-zinc-800 text-zinc-300'
                              }`}>
                                <span className="text-[10px] font-medium block mb-0.5 opacity-60 uppercase tracking-wide">
                                  {entry.role === 'user' ? 'Alumno' : 'Prospecto'}
                                </span>
                                {entry.text}
                              </div>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {!session.feedback && (!session.transcript || session.transcript.length === 0) && (
                      <p className="text-sm text-zinc-500 text-center py-2">
                        Esta sesión no tiene feedback ni transcripción guardados.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
