import { describe, it, expect } from 'vitest'
import { normalizeForStorage, formatForEvaluation } from './transcript'
import type { LiveTranscriptEntry } from '../types'

const sample: LiveTranscriptEntry[] = [
  { role: 'user', text: 'Hola, ¿cómo estás?' },
  { role: 'model', text: 'Bien, gracias.' },
]

describe('normalizeForStorage', () => {
  it('mapea model→assistant, text→content e inyecta timestamp', () => {
    const ts = '2026-06-26T10:00:00.000Z'
    const out = normalizeForStorage(sample, ts)
    expect(out).toEqual([
      { role: 'user', content: 'Hola, ¿cómo estás?', timestamp: ts },
      { role: 'assistant', content: 'Bien, gracias.', timestamp: ts },
    ])
  })
  it('array vacío → vacío', () => {
    expect(normalizeForStorage([], '2026-01-01T00:00:00.000Z')).toEqual([])
  })
})

describe('formatForEvaluation', () => {
  it('roles a VENDEDOR/PROSPECTO con separador', () => {
    expect(formatForEvaluation(sample)).toBe(
      'VENDEDOR: Hola, ¿cómo estás?\n\nPROSPECTO: Bien, gracias.',
    )
  })
  it('array vacío → cadena vacía', () => {
    expect(formatForEvaluation([])).toBe('')
  })
})
