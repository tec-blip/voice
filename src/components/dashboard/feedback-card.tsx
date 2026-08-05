'use client'

import type { EvaluationResult } from '@/lib/prompts/evaluation'
import { getGradeLabel, naCategoriesForType } from '@/lib/engine'

interface FeedbackCardProps {
  evaluation: EvaluationResult
  // Tipo de práctica: permite marcar como "No aplica" las categorías que ese
  // modo no puede ejecutar (p.ej. apertura/descubrimiento/presentación en el
  // drill de objeciones). Si no se pasa, se muestran las 6 (comportamiento previo).
  type?: string
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
  if (score >= 60) return 'text-yellow-400'
  if (score >= 40) return 'text-orange-400'
  return 'text-red-400'
}

function getBarColor(score: number): string {
  if (score >= 80) return 'bg-green-500'
  if (score >= 60) return 'bg-yellow-500'
  if (score >= 40) return 'bg-orange-500'
  return 'bg-red-500'
}

export function FeedbackCard({ evaluation, type }: FeedbackCardProps) {
  const categories = ['apertura', 'descubrimiento', 'presentacion', 'objeciones', 'cierre', 'tono'] as const
  const na = naCategoriesForType(type)

  return (
    <div className="space-y-6">
      {evaluation.feedback_source === 'heuristic' && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex items-start gap-2">
          <svg className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-xs text-amber-300/90 leading-relaxed">
            Evaluación provisional generada sin IA. La puntuación es una estimación
            determinista basada en tu transcripción; la evaluación detallada con IA no
            estuvo disponible.
          </p>
        </div>
      )}
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
            // Categoría que no aplica en este modo (drill): se muestra atenuada
            // como "No aplica" en vez de una barra con un número engañoso.
            if (na.has(cat)) {
              return (
                <div key={cat}>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-sm text-zinc-500">{CATEGORY_LABELS[cat]}</span>
                    <span className="text-xs text-zinc-500 italic">No aplica en este modo</span>
                  </div>
                  <div className="h-2 bg-zinc-800/50 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-zinc-700/40" style={{ width: '100%' }} />
                  </div>
                </div>
              )
            }
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
          <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
          </svg>
          <h3 className="text-sm font-semibold text-red-400">Momento clave</h3>
        </div>
        <p className="text-sm text-zinc-300 leading-relaxed italic">
          &ldquo;{evaluation.momento_critico}&rdquo;
        </p>
      </div>
    </div>
  )
}
