'use client'

import type { EvaluationResult } from '@/lib/prompts/evaluation'

interface FeedbackCardProps {
  evaluation: EvaluationResult
}

const CATEGORY_LABELS: Record<string, string> = {
  apertura: 'Apertura / Rapport',
  descubrimiento: 'Descubrimiento',
  presentacion: 'Presentación de valor',
  objeciones: 'Manejo de objeciones',
  cierre: 'Cierre',
  tono: 'Tono y energía',
}

function getScoreColor(score: number): string {
  if (score >= 80) return 'text-green-400'
  if (score >= 60) return 'text-blue-400'
  if (score >= 40) return 'text-yellow-400'
  return 'text-red-400'
}

function getBarColor(score: number): string {
  if (score >= 80) return 'bg-green-500'
  if (score >= 60) return 'bg-blue-500'
  if (score >= 40) return 'bg-yellow-500'
  return 'bg-red-500'
}

function getGradeLabel(score: number): string {
  if (score >= 90) return 'Excepcional'
  if (score >= 80) return 'Excelente'
  if (score >= 70) return 'Muy bien'
  if (score >= 60) return 'Bien'
  if (score >= 50) return 'Regular'
  if (score >= 40) return 'Necesita trabajo'
  return 'Debe mejorar'
}

export function FeedbackCard({ evaluation }: FeedbackCardProps) {
  const categories = ['apertura', 'descubrimiento', 'presentacion', 'objeciones', 'cierre', 'tono'] as const

  return (
    <div className="space-y-6">
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 text-center">
        <p className="text-sm text-zinc-500 uppercase tracking-wider">Puntuación general</p>
        <p className={`text-6xl font-bold mt-2 ${getScoreColor(evaluation.puntuacion_general)}`}>
          {evaluation.puntuacion_general}
        </p>
        <p className={`text-lg font-medium mt-1 ${getScoreColor(evaluation.puntuacion_general)}`}>
          {getGradeLabel(evaluation.puntuacion_general)}
        </p>
      </div>

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
          Desglose por categoría
        </h3>
        <div className="space-y-4">
          {categories.map((cat) => {
            const score = evaluation[cat] as number
            return (
              <div key={cat}>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-sm text-zinc-300">{CATEGORY_LABELS[cat]}</span>
                  <span className={`text-sm font-bold ${getScoreColor(score)}`}>{score}</span>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ease-out ${getBarColor(score)}`}
                    style={{ width: `${score}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="text-sm font-semibold text-green-400">Lo que hiciste bien</h3>
          </div>
          <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-line">
            {evaluation.feedback_positivo}
          </p>
        </div>

        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <h3 className="text-sm font-semibold text-yellow-400">Áreas de mejora</h3>
          </div>
          <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-line">
            {evaluation.feedback_mejora}
          </p>
        </div>
      </div>

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
          </svg>
          <h3 className="text-sm font-semibold text-blue-400">Momento clave</h3>
        </div>
        <p className="text-sm text-zinc-300 leading-relaxed italic">
          &ldquo;{evaluation.momento_critico}&rdquo;
        </p>
      </div>
    </div>
  )
}
