// Transformaciones de transcript — código puro, determinista.
//
// El hook de voz (use-gemini-live) produce { role:'user'|'model', text }.
// La DB espera { role:'user'|'assistant', content, timestamp }. La evaluación
// quiere texto plano "VENDEDOR/PROSPECTO". Antes esto vivía disperso en
// practice/page.tsx (normalización inline) y en evaluation.ts (formato).

import type { TranscriptEntry } from '@/lib/types/database'
import type { LiveTranscriptEntry } from '../types'

/**
 * Normaliza la forma del hook a la forma persistible en DB.
 * `model` → `assistant`, `text` → `content`, y se inyecta el timestamp dado
 * (se pasa como argumento para mantener la función pura y testeable).
 */
export function normalizeForStorage(
  entries: LiveTranscriptEntry[],
  endedAtISO: string,
): TranscriptEntry[] {
  return entries.map((e) => ({
    role: e.role === 'model' ? 'assistant' : 'user',
    content: e.text,
    timestamp: endedAtISO,
  }))
}

/** Formatea el transcript para el prompt de evaluación (VENDEDOR/PROSPECTO). */
export function formatForEvaluation(entries: LiveTranscriptEntry[]): string {
  return entries
    .map((e) => `${e.role === 'user' ? 'VENDEDOR' : 'PROSPECTO'}: ${e.text}`)
    .join('\n\n')
}
