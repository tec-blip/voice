'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/hooks/use-auth'
import { BADGES, getBadgeById } from '@/lib/utils/badges'

export default function ProfilePage() {
  const { user, loading: authLoading, signOut } = useAuth()
  const [sessionsCount, setSessionsCount] = useState(0)
  const [avgScore, setAvgScore] = useState<number | null>(null)
  const [earnedBadges, setEarnedBadges] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/sessions/list').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/rankings').then((r) => (r.ok ? r.json() : { rankings: [], currentUserId: null })),
    ])
      .then(([sessions, rankingsData]) => {
        const list = Array.isArray(sessions) ? sessions : []
        setSessionsCount(list.length)
        const scored = list.filter((s: { score: number | null }) => s.score !== null)
        if (scored.length > 0) {
          setAvgScore(Math.round(scored.reduce((a: number, s: { score: number }) => a + s.score, 0) / scored.length))
        }
        const myRanking = rankingsData.rankings?.find(
          (r: { user_id: string }) => r.user_id === rankingsData.currentUserId
        )
        if (myRanking?.badges) {
          setEarnedBadges(myRanking.badges)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-blue-500" />
      </div>
    )
  }

  const name = user?.user_metadata?.name || 'Usuario'
  const email = user?.email || ''
  const initials = name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
    : '—'

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-8 text-center">
        <div className="h-20 w-20 rounded-full bg-zinc-700 mx-auto flex items-center justify-center text-2xl font-bold text-zinc-300">
          {initials}
        </div>
        <h1 className="text-xl font-bold text-white mt-4">{name}</h1>
        <p className="text-sm text-zinc-500">{email}</p>
        <span className="inline-block mt-2 px-3 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">
          Alumno
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Sesiones', value: sessionsCount.toString() },
          { label: 'Promedio', value: avgScore !== null ? avgScore.toString() : '—' },
          { label: 'Miembro desde', value: memberSince },
          { label: 'Badges', value: earnedBadges.length.toString() },
        ].map((stat) => (
          <div key={stat.label} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 text-center">
            <p className="text-xl font-bold text-white">{stat.value}</p>
            <p className="text-xs text-zinc-500 mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
          Logros ({earnedBadges.length}/{BADGES.length})
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {BADGES.map((badge) => {
            const earned = earnedBadges.includes(badge.id)
            return (
              <div
                key={badge.id}
                className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border text-center transition-all ${
                  earned ? badge.color : 'bg-zinc-800/30 border-zinc-800 opacity-40 grayscale'
                }`}
                title={badge.description}
              >
                <span className="text-2xl">{badge.icon}</span>
                <span className="text-xs font-medium">{badge.name}</span>
                {!earned && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <svg className="w-5 h-5 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="text-center">
        <button
          onClick={signOut}
          className="inline-flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-6 py-2.5 text-sm font-medium text-zinc-300 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
          </svg>
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}
