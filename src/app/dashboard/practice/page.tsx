'use client'

import { useState, useCallback } from 'react'
import { PhoneUI } from '@/components/phone/phone-ui'
import { FeedbackCard } from '@/components/dashboard/feedback-card'
import { ROLEPLAY_CONFIGS, type RoleplayType } from '@/lib/prompts/roleplay'
import { formatTranscriptForEvaluation, type EvaluationResult } from '@/lib/prompts/evaluation'

type PageState = 'select' | 'calling' | 'evaluating' | 'results'

const roleplayTypes: { id: RoleplayType; icon: React.ReactNode }[] = [
  {
    id: 'cierre',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    id: 'llamada_fria',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
      </svg>
    ),
  },
  {
    id: 'framing',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
      </svg>
    ),
  },
  {
    id: 'objeciones',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
  },
  {
    id: 'general',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
      </svg>
    ),
  },
]

export default function PracticePage() {
  const [selected, setSelected] = useState<RoleplayType | null>(null)
  const [pageState, setPageState] = useState<PageState>('select')
  const [lastTranscript, setLastTranscript] = useState<{ role: 'user' | 'model'; text: string }[]>([])
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null)
  const [callDuration, setCallDuration] = useState(0)
  const [evalError, setEvalError] = useState<string | null>(null)

  const handleCallEnd = useCallback(async (transcript: { role: 'user' | 'model'; text: string }[], durationSeconds: number) => {
    console.log('[practice] handleCallEnd — transcript length =', transcript.length, 'duration =', durationSeconds, 's')
    setLastTranscript(transcript)
    setCallDuration(durationSeconds)

    if (transcript.length < 1) {
      console.warn('[practice] transcript empty — skipping evaluation')
      setPageState('select')
      return
    }

    setPageState('evaluating')
    setEvalError(null)

    try {
      const formatted = formatTranscriptForEvaluation(transcript)
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: formatted }),
      })

      if (!res.ok) throw new Error('Error al evaluar la llamada')

      const result: EvaluationResult = await res.json()
      setEvaluation(result)
      setPageState('results')

      try {
        const saveRes = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: selected,
            score: result.puntuacion_general,
            duration: durationSeconds,
            transcript: transcript,
            feedback: result,
          }),
        })
        if (!saveRes.ok) {
          const errBody = await saveRes.json().catch(() => ({}))
          console.error('[practice] failed to save session', saveRes.status, errBody)
        } else {
          console.log('[practice] session saved')
        }
      } catch (saveErr) {
        console.error('[practice] save session exception', saveErr)
      }
    } catch (err) {
      console.error('[practice] evaluation failed', err)
      setEvalError('No se pudo evaluar la llamada. Intenta de nuevo.')
      setPageState('results')
    }
  }, [selected])

  const handleNewPractice = () => {
    setPageState('select')
    setEvaluation(null)
    setLastTranscript([])
    setEvalError(null)
    setCallDuration(0)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white">
          {pageState === 'results' ? 'Resultados' : pageState === 'evaluating' ? 'Evaluando...' : 'Práctica de Roleplay'}
        </h1>
        <p className="text-zinc-400 mt-1">
          {pageState === 'results'
            ? `${ROLEPLAY_CONFIGS[selected!].label} — ${lastTranscript.length} intercambios`
            : pageState === 'evaluating'
              ? 'Analizando tu desempeño con IA...'
              : selected
                ? `Modo: ${ROLEPLAY_CONFIGS[selected].label}`
                : 'Selecciona un tipo de práctica para comenzar'}
        </p>
      </div>

      {pageState === 'evaluating' && (
        <div className="flex flex-col items-center justify-center py-16 space-y-4">
          <div className="relative">
            <div className="h-16 w-16 rounded-full border-4 border-zinc-800 border-t-blue-500 animate-spin" />
          </div>
          <p className="text-zinc-400 text-sm">Analizando transcripción...</p>
          <p className="text-zinc-600 text-xs">Evaluando 6 categorías de desempeño</p>
        </div>
      )}

      {pageState === 'results' && (
        <div className="space-y-6">
          {evaluation && <FeedbackCard evaluation={evaluation} />}

          {evalError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-5 text-center">
              <p className="text-red-400">{evalError}</p>
            </div>
          )}

          {lastTranscript.length > 0 && (
            <details className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
              <summary className="px-6 py-4 cursor-pointer text-sm font-medium text-zinc-400 hover:text-zinc-300">
                Ver transcripción completa ({lastTranscript.length} mensajes)
              </summary>
              <div className="px-6 pb-4 space-y-3 max-h-64 overflow-y-auto">
                {lastTranscript.map((entry, i) => (
                  <div key={i} className={`flex gap-3 ${entry.role === 'user' ? 'justify-end' : ''}`}>
                    <div className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                      entry.role === 'user'
                        ? 'bg-blue-600/20 text-blue-100'
                        : 'bg-zinc-800 text-zinc-300'
                    }`}>
                      <span className="text-xs font-medium block mb-1 opacity-60">
                        {entry.role === 'user' ? 'Tú' : 'Prospecto'}
                      </span>
                      {entry.text}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="flex justify-center">
            <button
              onClick={handleNewPractice}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 px-8 py-3 text-sm font-semibold text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
              Nueva práctica
            </button>
          </div>
        </div>
      )}

      {(pageState === 'select' || pageState === 'calling') && (
        <>
          <PhoneUI roleplayType={selected} onCallEnd={handleCallEnd} />

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {roleplayTypes.map((type) => (
              <button
                key={type.id}
                onClick={() => setSelected(type.id === selected ? null : type.id)}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors text-center ${
                  selected === type.id
                    ? 'border-blue-500 bg-blue-600/10 text-blue-400'
                    : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'
                }`}
              >
                {type.icon}
                <span className="text-xs font-medium">{ROLEPLAY_CONFIGS[type.id].label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
