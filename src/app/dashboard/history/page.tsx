'use client'

import { useEffect, useState } from 'react'

interface TranscriptEntry {
  role: 'user' | 'model'
  text: string
}

interface Session {
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

const TYPE_LABELS: Record<string, string> = {
  cierre: 'Cierre',
  llamada_fria: 'Llamada en frío',
  framing: 'Framing',
  objeciones: 'Objeciones',
  general: 'General',
}

const TYPE_COLORS: Record<string, string> = {
  cierre: 'bg-red-500/20 text-red-400',
  llamada_fria: 'bg-green-500/20 text-green-400',
  framing: 'bg-purple-500/20 text-purple-400',
  objeciones: 'bg-yellow-500/20 text-yellow-400',
  general: 'bg-zinc-500/20 text-zinc-400',
}

const FILTERS = ['todos', 'cierre', 'llamada_fria', 'framing', 'objeciones', 'general'] as const

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
  if (score === null) return 'text-zinc-500'
  if (score >= 80) return 'text-green-400'
  if (score >= 60) return 'text-red-400'
  if (score >= 40) return 'text-yellow-400'
  return 'text-red-400'
}

export default function HistoryPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('todos')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/sessions/list')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setSessions(Array.isArray(data) ? data : []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }, [])

  const filtered = filter === 'todos' ? sessions : sessions.filter((s) => s.type === filter)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-red-500" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Historial de Sesiones</h1>
        <p className="text-zinc-400 mt-1">{sessions.length} sesiones completadas</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === f
                ? 'bg-red-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            {f === 'todos' ? 'Todos' : TYPE_LABELS[f] || f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-8 text-center">
          <p className="text-zinc-400">
            {sessions.length === 0
              ? 'Aún no tienes sesiones. ¡Ve a Practicar para empezar!'
              : 'No hay sesiones de este tipo.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((session) => (
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
                        <p className="text-xs font-medium text-green-400 mb-1">Lo que hiciste bien</p>
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
                      <div className="px-3 pb-3 pt-1 space-y-2 max-h-80 overflow-y-auto">
                        {session.transcript.map((entry, i) => (
                          <div key={i} className={`flex ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                              entry.role === 'user'
                                ? 'bg-red-600/20 text-red-100'
                                : 'bg-zinc-800 text-zinc-300'
                            }`}>
                              <span className="text-[10px] font-medium block mb-0.5 opacity-60 uppercase tracking-wide">
                                {entry.role === 'user' ? 'Tú' : 'Prospecto'}
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
  )
}
