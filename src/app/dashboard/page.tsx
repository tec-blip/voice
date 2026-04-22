'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/hooks/use-auth'
import { ProgressChart } from '@/components/dashboard/progress-chart'

interface Session {
  id: string
  type: string
  score: number | null
  duration: number | null
  created_at: string
}

const TYPE_LABELS: Record<string, string> = {
  cierre: 'Cierre',
  llamada_fria: 'Llamada en frío',
  framing: 'Framing',
  objeciones: 'Objeciones',
  general: 'General',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth()
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/sessions/list')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setSessions(Array.isArray(data) ? data : []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }, [])

  const scored = sessions.filter((s) => s.score !== null)
  const totalSessions = sessions.length
  const avgScore = scored.length > 0 ? Math.round(scored.reduce((a, s) => a + s.score!, 0) / scored.length) : null
  const bestScore = scored.length > 0 ? Math.max(...scored.map((s) => s.score!)) : null

  const chartData = scored
    .slice()
    .reverse()
    .map((s) => ({ date: formatDate(s.created_at), score: s.score! }))

  const stats = [
    { label: 'Sesiones', value: totalSessions.toString(), icon: '📞' },
    { label: 'Promedio', value: avgScore !== null ? avgScore.toString() : '—', icon: '⭐' },
    { label: 'Mejor score', value: bestScore !== null ? bestScore.toString() : '—', icon: '🏆' },
    { label: 'Esta semana', value: sessions.filter((s) => {
      const d = new Date(s.created_at)
      const now = new Date()
      const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)
      return diff <= 7
    }).length.toString(), icon: '📅' },
  ]

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-blue-500" />
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">
          Hola, {user?.user_metadata?.name || 'Vendedor'}
        </h1>
        <p className="text-zinc-400 mt-1">Bienvenido a tu centro de entrenamiento</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
            <span className="text-2xl">{stat.icon}</span>
            <p className="text-2xl font-bold text-white mt-2">{stat.value}</p>
            <p className="text-xs text-zinc-500 mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      {chartData.length >= 2 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">Progreso</h2>
          <ProgressChart data={chartData} />
        </div>
      )}

      <div className="flex justify-center">
        <Link
          href="/dashboard/practice"
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 px-8 py-4 text-lg font-semibold text-white transition-colors shadow-lg shadow-blue-600/20"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
          </svg>
          Iniciar Práctica
        </Link>
      </div>

      {sessions.length > 0 ? (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Últimas sesiones</h2>
            <Link href="/dashboard/history" className="text-xs text-blue-400 hover:text-blue-300">Ver todas</Link>
          </div>
          <div className="space-y-3">
            {sessions.slice(0, 3).map((session) => (
              <div key={session.id} className="flex items-center justify-between p-3 rounded-lg bg-zinc-800/40">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-zinc-300">{TYPE_LABELS[session.type] || session.type}</span>
                  <span className="text-xs text-zinc-600">{formatDuration(session.duration)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-lg font-bold ${
                    (session.score ?? 0) >= 80 ? 'text-green-400' : (session.score ?? 0) >= 60 ? 'text-blue-400' : (session.score ?? 0) >= 40 ? 'text-yellow-400' : 'text-zinc-500'
                  }`}>
                    {session.score ?? '—'}
                  </span>
                  <span className="text-xs text-zinc-600">{formatDate(session.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-zinc-400 mt-4 font-medium">Aún no tienes sesiones</p>
          <p className="text-zinc-500 text-sm mt-1">¡Empieza tu primera práctica de roleplay!</p>
        </div>
      )}
    </div>
  )
}
