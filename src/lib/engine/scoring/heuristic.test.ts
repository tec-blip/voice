import { describe, it, expect } from 'vitest'
import { estimateScoresHeuristic } from './heuristic'
import { CATEGORY_KEYS } from './weights'
import type { LiveTranscriptEntry } from '../types'

const weak: LiveTranscriptEntry[] = [
  { role: 'user', text: 'Hola.' },
  { role: 'model', text: 'Hola.' },
]

const strong: LiveTranscriptEntry[] = [
  { role: 'user', text: 'Te explico cómo vamos a hacer la llamada y al final decidimos si tiene sentido.' },
  { role: 'model', text: 'Vale.' },
  { role: 'user', text: '¿Por qué agendaste esta llamada hoy? ¿Qué te pesa de tu situación? ¿Cuánto te gustaría generar?' },
  { role: 'model', text: 'Quiero más libertad financiera.' },
  { role: 'user', text: 'Déjame ver si te entendí: recuerda que me dijiste que quieres libertad. ¿Cómo lo ves?' },
  { role: 'model', text: 'Es caro.' },
  { role: 'user', text: 'Entiendo, y precisamente por eso; seguir como estás también tiene un coste. ¿Lo dividimos en cuotas?' },
  { role: 'model', text: 'Tiene sentido.' },
  { role: 'user', text: '¿Comenzamos ya? El siguiente paso es activar tu cuenta hoy.' },
]

describe('estimateScoresHeuristic', () => {
  it('devuelve las 6 categorías en [0,100] y un general en rango', () => {
    const r = estimateScoresHeuristic(strong)
    for (const k of CATEGORY_KEYS) {
      expect(r.scores[k]).toBeGreaterThanOrEqual(0)
      expect(r.scores[k]).toBeLessThanOrEqual(100)
    }
    expect(r.puntuacion_general).toBeGreaterThanOrEqual(0)
    expect(r.puntuacion_general).toBeLessThanOrEqual(100)
  })

  it('es determinista (mismo input → mismo output)', () => {
    expect(estimateScoresHeuristic(strong)).toEqual(estimateScoresHeuristic(strong))
  })

  it('una llamada con más señal puntúa más que una pobre', () => {
    expect(estimateScoresHeuristic(strong).puntuacion_general)
      .toBeGreaterThan(estimateScoresHeuristic(weak).puntuacion_general)
  })

  it('maneja transcript vacío sin romper', () => {
    const r = estimateScoresHeuristic([])
    expect(r.puntuacion_general).toBeGreaterThanOrEqual(0)
    expect(r.notas).toEqual([])
  })

  it('detecta señales de fase en una llamada fuerte', () => {
    const r = estimateScoresHeuristic(strong)
    expect(r.notas.length).toBeGreaterThan(0)
    expect(r.feedback_positivo.length).toBeGreaterThan(0)
  })
})
