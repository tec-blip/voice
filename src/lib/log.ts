/**
 * Logging estructurado (JSON) para rutas server. Reemplaza los `console.*`
 * sueltos por una línea parseable en los logs de Vercel, con campos comunes
 * (ruta, userId, sessionId) y métricas de costo de IA.
 *
 * Uso:
 *   log.info('vertex/config', 'session started', { userId, sessionId })
 *   log.cost('evaluate', { userId, evalInputTokens, evalOutputTokens, estEvalCostUsd })
 */

type Level = 'debug' | 'info' | 'warn' | 'error'

interface LogFields {
  userId?: string
  sessionId?: string
  [key: string]: unknown
}

function emit(level: Level, route: string, msg: string, fields?: LogFields) {
  const line = JSON.stringify({ level, route, msg, ...fields })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export interface CostFields extends LogFields {
  voiceSeconds?: number
  estVoiceCostUsd?: number
  evalInputTokens?: number
  evalOutputTokens?: number
  estEvalCostUsd?: number
}

export const log = {
  debug: (route: string, msg: string, fields?: LogFields) => emit('debug', route, msg, fields),
  info:  (route: string, msg: string, fields?: LogFields) => emit('info', route, msg, fields),
  warn:  (route: string, msg: string, fields?: LogFields) => emit('warn', route, msg, fields),
  error: (route: string, msg: string, fields?: LogFields) => emit('error', route, msg, fields),
  /** Atajo para registrar costo estimado de IA por request/sesión. */
  cost:  (route: string, fields: CostFields) => emit('info', route, 'ai_cost', fields),
}

// Tarifas para estimar costo (USD). Sobrescribibles por env.
export const PRICING = {
  voiceUsdPerMin: Number(process.env.VERTEX_VOICE_USD_PER_MIN ?? 0.05),
  evalInputUsdPerMTok: Number(process.env.GEMINI_FLASH_INPUT_USD_PER_MTOK ?? 0.15),
  evalOutputUsdPerMTok: Number(process.env.GEMINI_FLASH_OUTPUT_USD_PER_MTOK ?? 0.60),
}

export function estimateVoiceCostUsd(seconds: number): number {
  return (seconds / 60) * PRICING.voiceUsdPerMin
}

export function estimateEvalCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * PRICING.evalInputUsdPerMTok +
    (outputTokens / 1_000_000) * PRICING.evalOutputUsdPerMTok
  )
}
