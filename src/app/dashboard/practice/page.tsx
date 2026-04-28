'use client'

import { useState, useCallback } from 'react'
import { PhoneUI } from '@/components/phone/phone-ui'
import { FeedbackCard } from '@/components/dashboard/feedback-card'
import {
  ROLEPLAY_CONFIGS,
  NICHO_LABELS,
  buildScenarioPrompt,
  getVoiceByGender,
  type RoleplayType,
  type Nicho,
  type ScenarioBrief,
} from '@/lib/prompts/roleplay'
import { formatTranscriptForEvaluation, type EvaluationResult } from '@/lib/prompts/evaluation'

type PageState = 'select' | 'calling' | 'evaluating' | 'results'

// ── Iconos ────────────────────────────────────────────────────────────────────

const NichoIcon = ({ nicho }: { nicho: Nicho }) => {
  if (nicho === 'trading') return (
    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
    </svg>
  )
  if (nicho === 'marca_personal_instagram') return (
    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  )
  return (
    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" />
    </svg>
  )
}

const RoleplayIcon = ({ id }: { id: RoleplayType }) => {
  const paths: Record<RoleplayType, string> = {
    cierre: 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    llamada_fria: 'M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z',
    framing: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z',
    objeciones: 'M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
    general: 'M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155',
  }
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d={paths[id]} />
    </svg>
  )
}

// ── Difficulty dots ───────────────────────────────────────────────────────────

function DifficultyDots({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <div className="flex gap-1 items-center">
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className={`w-2 h-2 rounded-full ${
            i < value ? 'bg-orange-400' : 'bg-zinc-700'
          }`}
        />
      ))}
    </div>
  )
}

// ── Scenario preview card ─────────────────────────────────────────────────────

function ScenarioCard({ scenario, onRefresh }: { scenario: ScenarioBrief; onRefresh: () => void }) {
  const ei = scenario.estado_inicial
  return (
    <div className="bg-zinc-900/60 border border-zinc-700 rounded-2xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1">Cliente de hoy</p>
          <h3 className="text-white font-semibold text-base leading-snug">{scenario.arquetipo_label}</h3>
        </div>
        <button
          onClick={onRefresh}
          className="flex-shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors p-1"
          title="Otro cliente"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="bg-zinc-800/60 rounded-lg px-3 py-2">
          <p className="text-zinc-500 text-xs mb-0.5">Tono inicial</p>
          <p className="text-zinc-200 capitalize">{ei.tono_inicial ?? '—'}</p>
        </div>
        <div className="bg-zinc-800/60 rounded-lg px-3 py-2">
          <p className="text-zinc-500 text-xs mb-0.5">País</p>
          <p className="text-zinc-200">{ei.pais ?? '—'}</p>
        </div>
        <div className="bg-zinc-800/60 rounded-lg px-3 py-2">
          <p className="text-zinc-500 text-xs mb-0.5">Ocupación</p>
          <p className="text-zinc-200 truncate">{ei.ocupacion ?? '—'}</p>
        </div>
        <div className="bg-zinc-800/60 rounded-lg px-3 py-2">
          <p className="text-zinc-500 text-xs mb-0.5">Presupuesto inicial</p>
          <p className="text-zinc-200">{ei.presupuesto_inicial ?? 'No revelado'}</p>
        </div>
      </div>

      {scenario.objeciones_a_plantear.length > 0 && (
        <div>
          <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-2">
            Objeciones ({scenario.objeciones_a_plantear.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {scenario.objeciones_a_plantear.map((o, i) => (
              <span
                key={i}
                className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 capitalize"
              >
                {o.tipo ?? 'otro'}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-1 border-t border-zinc-800">
        <div>
          <p className="text-zinc-500 text-xs mb-1">Dificultad</p>
          <DifficultyDots value={scenario.dificultad_1_5 ?? 3} />
        </div>
        <div className="text-right">
          <p className="text-zinc-500 text-xs mb-1">Resistencia al cierre</p>
          <DifficultyDots value={scenario.resistencia_1_5 ?? 3} />
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PracticePage() {
  const [selectedNicho, setSelectedNicho] = useState<Nicho | null>(null)
  const [selectedType, setSelectedType] = useState<RoleplayType | null>(null)
  const [scenario, setScenario] = useState<ScenarioBrief | null>(null)
  const [loadingScenario, setLoadingScenario] = useState(false)
  const [pageState, setPageState] = useState<PageState>('select')
  const [lastTranscript, setLastTranscript] = useState<{ role: 'user' | 'model'; text: string }[]>([])
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null)
  const [callDuration, setCallDuration] = useState(0)
  const [evalError, setEvalError] = useState<string | null>(null)

  const fetchScenario = useCallback(async (nicho: Nicho) => {
    setLoadingScenario(true)
    setScenario(null)
    try {
      const res = await fetch(`/api/scenarios?nicho=${nicho}`)
      if (res.ok) setScenario(await res.json())
    } catch {
      // silently fail — call will use generic prompt
    } finally {
      setLoadingScenario(false)
    }
  }, [])

  const handleSelectNicho = (nicho: Nicho) => {
    setSelectedNicho(nicho)
    fetchScenario(nicho)
  }

  const handleRefreshScenario = () => {
    if (selectedNicho) fetchScenario(selectedNicho)
  }

  const systemPromptOverride =
    scenario && selectedType
      ? buildScenarioPrompt(selectedType, scenario)
      : undefined

  const voiceName = scenario
    ? getVoiceByGender(scenario.estado_inicial.genero)
    : undefined

  const handleCallEnd = useCallback(async (
    transcript: { role: 'user' | 'model'; text: string }[],
    durationSeconds: number,
    meta?: { endedBy: 'user' | 'model'; reason?: string; summary?: string }
  ) => {
    setLastTranscript(transcript)
    setCallDuration(durationSeconds)
    if (transcript.length < 1) { setPageState('select'); return }
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
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: selectedType,
          score: result.puntuacion_general,
          duration: durationSeconds,
          transcript,
          feedback: result,
        }),
      }).catch(() => {})
    } catch (err) {
      console.error('[practice] evaluation failed', err)
      setEvalError('No se pudo evaluar la llamada. Intenta de nuevo.')
      setPageState('results')
    }
  }, [selectedType])

  const handleNewPractice = () => {
    setPageState('select')
    setEvaluation(null)
    setLastTranscript([])
    setEvalError(null)
    setCallDuration(0)
    setScenario(null)
    setSelectedNicho(null)
    setSelectedType(null)
  }

  // ── Nichos config ────────────────────────────────────────────
  const nichos: { id: Nicho; gradient: string; border: string; activeBg: string }[] = [
    { id: 'trading', gradient: 'from-blue-500 to-indigo-600', border: 'border-blue-500', activeBg: 'bg-blue-600/10' },
    { id: 'marca_personal_instagram', gradient: 'from-pink-500 to-orange-500', border: 'border-pink-500', activeBg: 'bg-pink-600/10' },
    { id: 'aleatorio', gradient: 'from-violet-500 to-cyan-500', border: 'border-violet-500', activeBg: 'bg-violet-600/10' },
  ]

  const roleplayTypes: RoleplayType[] = ['cierre', 'llamada_fria', 'framing', 'objeciones', 'general']

  // ── Render ───────────────────────────────────────────────────
  if (pageState === 'evaluating') return (
    <div className="max-w-4xl mx-auto">
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <div className="h-16 w-16 rounded-full border-4 border-zinc-800 border-t-blue-500 animate-spin" />
        <p className="text-zinc-400 text-sm">Analizando transcripción...</p>
        <p className="text-zinc-600 text-xs">Evaluando 6 categorías de desempeño</p>
      </div>
    </div>
  )

  if (pageState === 'results') return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white">Resultados</h1>
        <p className="text-zinc-400 mt-1">
          {selectedType && ROLEPLAY_CONFIGS[selectedType].label}
          {scenario && ` · ${scenario.arquetipo_label}`}
          {` · ${lastTranscript.length} intercambios · ${Math.round(callDuration / 60)} min`}
        </p>
      </div>
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
                  entry.role === 'user' ? 'bg-blue-600/20 text-blue-100' : 'bg-zinc-800 text-zinc-300'
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
        <button onClick={handleNewPractice}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 px-8 py-3 text-sm font-semibold text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
          </svg>
          Nueva práctica
        </button>
      </div>
    </div>
  )

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white">
          {pageState === 'calling' ? 'Llamada en curso' : 'Práctica de Roleplay'}
        </h1>
        <p className="text-zinc-400 mt-1">
          {pageState === 'calling' && scenario
            ? `${scenario.arquetipo_label} · ${selectedType ? ROLEPLAY_CONFIGS[selectedType].label : ''}`
            : 'Elige nicho, tipo de práctica y habla con un cliente real'}
        </p>
      </div>

      {/* Phone */}
      <PhoneUI
        roleplayType={selectedType}
        systemPromptOverride={systemPromptOverride}
        voiceName={voiceName}
        onCallEnd={handleCallEnd}
      />

      {(pageState === 'select') && (
        <div className="space-y-6">

          {/* ── Paso 1: Nicho ── */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">
              1 · Elige el nicho del cliente
            </p>
            <div className="grid grid-cols-3 gap-3">
              {nichos.map(({ id, gradient, border, activeBg }) => (
                <button
                  key={id}
                  onClick={() => handleSelectNicho(id)}
                  className={`relative flex flex-col items-center gap-3 p-5 rounded-2xl border transition-all text-center ${
                    selectedNicho === id
                      ? `${border} ${activeBg}`
                      : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700'
                  }`}
                >
                  <div className={`p-2.5 rounded-xl bg-gradient-to-br ${gradient} text-white`}>
                    <NichoIcon nicho={id} />
                  </div>
                  <span className={`text-sm font-semibold ${selectedNicho === id ? 'text-white' : 'text-zinc-400'}`}>
                    {NICHO_LABELS[id]}
                  </span>
                  {loadingScenario && selectedNicho === id && (
                    <div className="absolute inset-0 rounded-2xl bg-zinc-900/60 flex items-center justify-center">
                      <div className="w-5 h-5 rounded-full border-2 border-zinc-600 border-t-white animate-spin" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* ── Paso 2: Tipo de práctica ── */}
          {selectedNicho && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">
                2 · Tipo de práctica
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {roleplayTypes.map((id) => (
                  <button
                    key={id}
                    onClick={() => setSelectedType(id === selectedType ? null : id)}
                    className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors text-center ${
                      selectedType === id
                        ? 'border-blue-500 bg-blue-600/10 text-blue-400'
                        : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'
                    }`}
                  >
                    <RoleplayIcon id={id} />
                    <span className="text-xs font-medium">{ROLEPLAY_CONFIGS[id].label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Paso 3: Preview del cliente ── */}
          {selectedNicho && selectedType && scenario && !loadingScenario && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">
                3 · Tu cliente de hoy
              </p>
              <ScenarioCard scenario={scenario} onRefresh={handleRefreshScenario} />
              <p className="text-center text-xs text-zinc-600 mt-2">
                Basado en una llamada de venta real · Pulsa <span className="text-zinc-400">↺</span> para cambiar cliente
              </p>
            </div>
          )}

          {selectedNicho && selectedType && loadingScenario && (
            <div className="flex justify-center py-4">
              <div className="w-6 h-6 rounded-full border-2 border-zinc-600 border-t-blue-400 animate-spin" />
            </div>
          )}

        </div>
      )}
    </div>
  )
}
