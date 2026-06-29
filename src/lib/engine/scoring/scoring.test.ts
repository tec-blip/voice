import { describe, it, expect } from 'vitest'
import {
  clampScore,
  normalizeCategoryScores,
  computeOverallScore,
  getGradeLabel,
  getSkillLevel,
} from './scoring'
import { WEIGHT_DENOMINATOR, DEFAULT_CATEGORY_SCORE, type CategoryScores } from './weights'

const all = (n: number): CategoryScores => ({
  apertura: n, descubrimiento: n, presentacion: n, objeciones: n, cierre: n, tono: n,
})

describe('clampScore', () => {
  it('redondea y clampa a [0,100]', () => {
    expect(clampScore(73.6)).toBe(74)
    expect(clampScore(-5)).toBe(0)
    expect(clampScore(150)).toBe(100)
  })
  it('devuelve el fallback ante valores no numéricos', () => {
    expect(clampScore(undefined)).toBe(DEFAULT_CATEGORY_SCORE)
    expect(clampScore(null)).toBe(DEFAULT_CATEGORY_SCORE)
    expect(clampScore(NaN)).toBe(DEFAULT_CATEGORY_SCORE)
    expect(clampScore('80')).toBe(DEFAULT_CATEGORY_SCORE)
    expect(clampScore(Infinity)).toBe(DEFAULT_CATEGORY_SCORE)
    expect(clampScore('abc', 10)).toBe(10)
  })
})

describe('normalizeCategoryScores', () => {
  it('rellena categorías faltantes con el default', () => {
    const out = normalizeCategoryScores({ apertura: 80 })
    expect(out.apertura).toBe(80)
    expect(out.descubrimiento).toBe(DEFAULT_CATEGORY_SCORE)
  })
  it('sanea basura y maneja null/undefined', () => {
    expect(normalizeCategoryScores(null).cierre).toBe(DEFAULT_CATEGORY_SCORE)
    const out = normalizeCategoryScores({ cierre: 'mucho', tono: 200 })
    expect(out.cierre).toBe(DEFAULT_CATEGORY_SCORE)
    expect(out.tono).toBe(100)
  })
})

describe('computeOverallScore', () => {
  it('todos-100 → 100 y todos-0 → 0', () => {
    expect(computeOverallScore(all(100))).toBe(100)
    expect(computeOverallScore(all(0))).toBe(0)
  })
  it('un valor constante se promedia a sí mismo', () => {
    expect(computeOverallScore(all(60))).toBe(60)
  })
  it('descubrimiento y cierre pesan el doble', () => {
    // Solo descubrimiento=100, resto 0 → 2/8.5 ≈ 23.5 → 24
    const soloDescubrimiento = { ...all(0), descubrimiento: 100 }
    expect(computeOverallScore(soloDescubrimiento)).toBe(Math.round((2 / WEIGHT_DENOMINATOR) * 100))
    // Solo apertura=100 (peso 1) pesa la mitad que descubrimiento
    const soloApertura = { ...all(0), apertura: 100 }
    expect(computeOverallScore(soloApertura)).toBe(Math.round((1 / WEIGHT_DENOMINATOR) * 100))
  })
  it('sanea valores inválidos antes de promediar', () => {
    const dirty = { ...all(100), cierre: NaN as unknown as number }
    // cierre cae a 50; resto 100
    const expected = Math.round(
      (100 * 1 + 100 * 2 + 100 * 1 + 100 * 1.5 + 50 * 2 + 100 * 1) / WEIGHT_DENOMINATOR,
    )
    expect(computeOverallScore(dirty)).toBe(expected)
  })
})

describe('getGradeLabel', () => {
  it('mapea las fronteras', () => {
    expect(getGradeLabel(90)).toBe('Excepcional')
    expect(getGradeLabel(80)).toBe('Excelente')
    expect(getGradeLabel(70)).toBe('Muy bien')
    expect(getGradeLabel(60)).toBe('Bien')
    expect(getGradeLabel(50)).toBe('Regular')
    expect(getGradeLabel(40)).toBe('Necesita trabajo')
    expect(getGradeLabel(39)).toBe('Debe mejorar')
  })
})

describe('getSkillLevel', () => {
  it('mapea las fronteras de la escala de la metodología', () => {
    expect(getSkillLevel(85)).toBe('elite')
    expect(getSkillLevel(84)).toBe('avanzado')
    expect(getSkillLevel(70)).toBe('avanzado')
    expect(getSkillLevel(69)).toBe('en_desarrollo')
    expect(getSkillLevel(55)).toBe('en_desarrollo')
    expect(getSkillLevel(54)).toBe('principiante')
    expect(getSkillLevel(40)).toBe('principiante')
    expect(getSkillLevel(39)).toBe('basico')
  })
})
