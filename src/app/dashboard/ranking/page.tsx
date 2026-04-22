'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/hooks/use-auth'
import { getBadgeById } from '@/lib/utils/badges'

interface RankingEntry {
  user_id: string
  name: string
  avg_score: number
  total_score: number
  sessions_count: number
  rank: number
  badges: string[]
}

const MEDAL_COLORS = ['from-yellow-500/20 to-yellow-600/5 border-yellow-500/30', 'from-zinc-400/20 to-zinc-500/5 border-zinc-400/30', 'from-amber-600/20 to-amber-700/5 border-amber-600/30']
const MEDAL_ICONS = ['🥇', '🥈', '🥉']

function scoreColor(score: number): string {
  if (score >= 80) return 'text-green-400'
  if (score >= 60) return 'text-blue-400'
  if (score >= 40) return 'text-yellow-400'
  return 'text-zinc-500'
}

export default function RankingPage() {
  const { user } = useAuth()
  const [rankings, setRankings] = useState<RankingEntry[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/rankings')
      .then((res) => (res.ok ? res.json() : { rankings: [] }))
      .then((data) => {
        setRankings(data.rankings || [])
        setCurrentUserId(data.currentUserId || null)
      })
      .catch(() => setRankings([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-blue-500" />
      </div>
    )
  }

  const top3 = rankings.slice(0, 3)
  const rest = rankings.slice(3)

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white">Ranking Global</h1>
        <p className="text-zinc-400 mt-1">{rankings.length} participantes</p>
      </div>

      {rankings.length === 0 ? (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-8 text-center">
          <p className="text-zinc-400">Aún no hay rankings. ¡Completa sesiones para aparecer!</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {top3.map((entry, i) => {
              const isCurrentUser = entry.user_id === currentUserId
              return (
                <div
                  key={entry.user_id}
                  className={`bg-gradient-to-b ${MEDAL_COLORS[i]} border rounded-xl p-5 text-center ${
                    isCurrentUser ? 'ring-2 ring-blue-500/50' : ''
                  } ${i === 0 ? 'sm:order-2 sm:-mt-4' : i === 1 ? 'sm:order-1' : 'sm:order-3'}`}
                >
                  <span className="text-3xl">{MEDAL_ICONS[i]}</span>
                  <div className="mt-3">
                    <div className="h-12 w-12 rounded-full bg-zinc-700 mx-auto flex items-center justify-center text-lg font-bold text-zinc-300">
                      {entry.name[0]?.toUpperCase() || '?'}
                    </div>
                    <p className="text-white font-semibold mt-2 truncate">{entry.name}</p>
                    <p className={`text-2xl font-bold mt-1 ${scoreColor(entry.avg_score)}`}>
                      {Math.round(entry.avg_score)}
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5">{entry.sessions_count} sesiones</p>
                    {entry.badges.length > 0 && (
                      <div className="flex justify-center gap-1 mt-2">
                        {entry.badges.slice(0, 3).map((b) => {
                          const badge = getBadgeById(b)
                          return badge ? <span key={b} title={badge.name}>{badge.icon}</span> : null
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {rest.length > 0 && (
            <div className="space-y-2">
              {rest.map((entry) => {
                const isCurrentUser = entry.user_id === currentUserId
                return (
                  <div
                    key={entry.user_id}
                    className={`flex items-center justify-between p-4 rounded-xl transition-colors ${
                      isCurrentUser
                        ? 'bg-blue-600/5 ring-1 ring-blue-500/30'
                        : 'bg-zinc-900/50 border border-zinc-800 hover:bg-zinc-800/50'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <span className="text-sm font-bold text-zinc-500 w-8 text-right">#{entry.rank}</span>
                      <div className="h-9 w-9 rounded-full bg-zinc-700 flex items-center justify-center text-sm font-medium text-zinc-300">
                        {entry.name[0]?.toUpperCase() || '?'}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{entry.name}</p>
                        <p className="text-xs text-zinc-500">{entry.sessions_count} sesiones</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {entry.badges.slice(0, 3).map((b) => {
                        const badge = getBadgeById(b)
                        return badge ? <span key={b} className="text-sm" title={badge.name}>{badge.icon}</span> : null
                      })}
                      <span className={`text-lg font-bold ${scoreColor(entry.avg_score)}`}>
                        {Math.round(entry.avg_score)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
