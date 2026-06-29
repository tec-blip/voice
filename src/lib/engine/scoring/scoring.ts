// Scoring determinista — funciona sin LLM.
//
// El LLM (Gemini Flash) entrega las 6 categorías cualitativas crudas; TODO lo
// numérico (saneado, promedio ponderado, etiquetas) se calcula aquí. Si el modelo
// devuelve un `puntuacion_general`, se ignora: lo recalcula `computeOverallScore`.

import {
  CATEGORY_KEYS,
  CATEGORY_WEIGHTS,
  WEIGHT_DENOMINATOR,
  DEFAULT_CATEGORY_SCORE,
  type CategoryKey,
  type CategoryScores,
} from './weights'

export type { CategoryKey, CategoryScores } from './weights'

/** Nivel cualitativo discreto. Reutilizable en UI/insignias. */
export type SkillLevel = 'elite' | 'avanzado' | 'en_desarrollo' | 'principiante' | 'basico'

/**
 * Clampa un valor a un entero en [0,100]. Si el valor no es un número finito
 * (undefined, null, NaN, string, etc.) devuelve `fallback`. Única fuente de
 * verdad del saneo de scores — antes estaba duplicada en evaluate y sessions.
 */
export function clampScore(value: unknown, fallback: number = DEFAULT_CATEGORY_SCORE): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(100, Math.round(value)))
}

/**
 * Toma un objeto crudo (posiblemente del LLM, posiblemente con basura o claves
 * faltantes) y devuelve las 6 categorías saneadas a [0,100]. Las ausentes/inválidas
 * toman DEFAULT_CATEGORY_SCORE.
 */
export function normalizeCategoryScores(raw: Record<string, unknown> | null | undefined): CategoryScores {
  const source = raw ?? {}
  const out = {} as CategoryScores
  for (const key of CATEGORY_KEYS) {
    out[key] = clampScore(source[key])
  }
  return out
}

/**
 * Promedio ponderado determinista. Reemplaza el cálculo que antes hacía el LLM.
 * Σ(score[cat] · peso[cat]) / suma_de_pesos, redondeado y clampeado a [0,100].
 */
export function computeOverallScore(scores: CategoryScores): number {
  let weighted = 0
  for (const key of CATEGORY_KEYS) {
    const value = clampScore(scores[key])
    weighted += value * CATEGORY_WEIGHTS[key as CategoryKey]
  }
  return Math.max(0, Math.min(100, Math.round(weighted / WEIGHT_DENOMINATOR)))
}

/** Etiqueta amigable para mostrar junto a un score. Movida desde feedback-card.tsx. */
export function getGradeLabel(score: number): string {
  if (score >= 90) return 'Excepcional'
  if (score >= 80) return 'Excelente'
  if (score >= 70) return 'Muy bien'
  if (score >= 60) return 'Bien'
  if (score >= 50) return 'Regular'
  if (score >= 40) return 'Necesita trabajo'
  return 'Debe mejorar'
}

/** Nivel discreto según la escala de la metodología (evaluation.ts líneas 152-157). */
export function getSkillLevel(score: number): SkillLevel {
  if (score >= 85) return 'elite'
  if (score >= 70) return 'avanzado'
  if (score >= 55) return 'en_desarrollo'
  if (score >= 40) return 'principiante'
  return 'basico'
}
