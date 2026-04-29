'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useMicrophone } from '@/lib/hooks/use-microphone'
import { useGeminiLive, type CallEndReason } from '@/lib/hooks/use-gemini-live'
import { AudioVisualizer } from './audio-visualizer'
import type { RoleplayType } from '@/lib/prompts/roleplay'
import { getRoleplayPrompt } from '@/lib/prompts/roleplay'

type CallState = 'idle' | 'connecting' | 'active' | 'ended'

interface PhoneUIProps {
  roleplayType: RoleplayType | null
  systemPromptOverride?: string
  voiceName?: string
  onCallEnd?: (
    transcript: { role: 'user' | 'model'; text: string }[],
    durationSeconds: number,
    meta?: { endedBy: 'user' | 'model'; reason?: CallEndReason; summary?: string }
  ) => void
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export function PhoneUI({ roleplayType, systemPromptOverride, voiceName, onCallEnd }: PhoneUIProps) {
  const [callState, setCallState] = useState<CallState>('idle')
  const [isMuted, setIsMuted] = useState(false)
  const [duration, setDuration] = useState(0)
  const [lastText, setLastText] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // ── Screen Wake Lock ───────────────────────────────────────────────────────
  // Mantiene la pantalla encendida durante la llamada activa.
  // Sin esto, iOS/Android apaga la pantalla, suspende el AudioContext y corta
  // el WebSocket, terminando la llamada bruscamente.
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null)
  useEffect(() => {
    if (callState !== 'active') {
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
      return
    }
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void>; addEventListener: (e: string, h: () => void) => void }> }
    }
    if (!nav.wakeLock) return // API no disponible (algunos Android WebView)

    let released = false
    const acquire = () => {
      nav.wakeLock!.request('screen')
        .then((lock) => {
          if (released) { lock.release().catch(() => {}); return }
          wakeLockRef.current = lock
          // El OS puede liberar el lock al ir a background; lo re-adquirimos
          // automáticamente al volver (visibilitychange → visible).
          lock.addEventListener('release', () => {
            if (!released) {
              document.addEventListener(
                'visibilitychange',
                function reacquire() {
                  if (document.visibilityState === 'visible' && !released) {
                    document.removeEventListener('visibilitychange', reacquire)
                    acquire()
                  }
                }
              )
            }
          })
        })
        .catch(() => {}) // silently fail — el Wake Lock es un "nice to have"
    }
    acquire()

    return () => {
      released = true
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
    }
  }, [callState])

  const systemPrompt = systemPromptOverride ?? (roleplayType ? getRoleplayPrompt(roleplayType) : '')

  // Refs volátiles para que el callback onModelHangup (que Gemini invoca desde
  // dentro del hook) lea siempre la duración y el transcript actuales en vez
  // de un closure stale.
  const durationRef = useRef(0)
  durationRef.current = duration
  const finalizeCallRef = useRef<(meta: { endedBy: 'user' | 'model'; reason?: CallEndReason; summary?: string }) => void>(() => {})

  const gemini = useGeminiLive({
    systemPrompt,
    voiceName: voiceName ?? 'Kore',
    onTranscript: useCallback((entry: { role: 'user' | 'model'; text: string }) => {
      setLastText(entry.text)
    }, []),
    onError: useCallback((error: string) => {
      console.error('Gemini error:', error)
      setErrorMessage(error)
      setCallState('idle')
    }, []),
    onModelHangup: useCallback((info: { reason: CallEndReason; summary?: string }) => {
      console.log('[phone-ui] model requested hangup', info)
      finalizeCallRef.current({ endedBy: 'model', reason: info.reason, summary: info.summary })
    }, []),
  })

  const microphone = useMicrophone({
    onAudioData: useCallback((data: Float32Array) => {
      gemini.sendAudio(data)
    }, [gemini]),
    onError: useCallback((error: string) => {
      console.error('Microphone error:', error)
      setErrorMessage(error)
      setCallState('idle')
    }, []),
  })

  // Límites de duración por sesión
  const MAX_CALL_SECONDS  = 45 * 60  // 2700 s — hard cap por sesión
  const WARN_CALL_SECONDS = 40 * 60  // 2400 s — aviso "quedan 5 minutos"

  useEffect(() => {
    if (callState !== 'active') return
    const interval = setInterval(() => setDuration((d) => d + 1), 1000)
    return () => clearInterval(interval)
  }, [callState])

  // Auto-hangup al alcanzar el límite máximo de la sesión
  useEffect(() => {
    if (callState !== 'active') return
    if (duration >= MAX_CALL_SECONDS) {
      finalizeCallRef.current({ endedBy: 'model', reason: 'timeout' })
    }
  }, [duration, callState, MAX_CALL_SECONDS])

  useEffect(() => {
    if (gemini.isConnected && callState === 'connecting') {
      setCallState('active')
    }
  }, [gemini.isConnected, callState])

  const handleCall = useCallback(async () => {
    if (!roleplayType) return
    if (callState !== 'idle' && callState !== 'ended') return

    setDuration(0)
    setIsMuted(false)
    setLastText('')
    setErrorMessage(null)
    setCallState('connecting')

    try {
      await gemini.connect()
      const stream = await microphone.start()
      if (!stream) {
        setCallState('idle')
        gemini.disconnect()
        return
      }
    } catch {
      setCallState('idle')
    }
  }, [callState, roleplayType, gemini, microphone])

  // Cleanup centralizado: lo usan tanto el botón rojo como el auto-hangup
  // disparado por el modelo. Idempotente — si se llama dos veces (ej. user
  // cuelga al mismo tiempo que el modelo pide end_call), la segunda invocación
  // no hace nada porque callState ya es 'ended'.
  // onCallEnd se invoca con setTimeout(0) para sacarlo del ciclo de render de React
  // y evitar el warning "setState during render" en PracticePage.
  const finalizeCall = useCallback(
    (meta: { endedBy: 'user' | 'model'; reason?: CallEndReason; summary?: string }) => {
      setCallState((prev) => {
        if (prev === 'ended') return prev
        const finalTranscript = gemini.transcript
        const finalDuration = durationRef.current
        microphone.stop()
        gemini.disconnect()
        setTimeout(() => onCallEnd?.(finalTranscript, finalDuration, meta), 0)
        return 'ended'
      })
    },
    [microphone, gemini, onCallEnd]
  )
  finalizeCallRef.current = finalizeCall

  const handleHangup = useCallback(() => {
    finalizeCall({ endedBy: 'user', reason: 'manual' })
  }, [finalizeCall])

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev)
  }, [])

  const canCall = roleplayType !== null

  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl shadow-2xl shadow-black/40 overflow-hidden">
        <div className="px-6 pt-8 pb-4 text-center">
          <div className={`h-12 w-12 rounded-full mx-auto flex items-center justify-center ${
            gemini.isModelSpeaking ? 'bg-blue-600/20 ring-2 ring-blue-500/40' : 'bg-zinc-700'
          } transition-all`}>
            <svg className={`w-6 h-6 ${gemini.isModelSpeaking ? 'text-blue-400' : 'text-zinc-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
          <p className="text-white font-semibold mt-3">
            {callState === 'idle' ? 'Prospecto IA' : callState === 'connecting' ? 'Conectando...' : callState === 'ended' ? 'Llamada finalizada' : gemini.isModelSpeaking ? 'Hablando...' : 'Escuchando...'}
          </p>
          <p className={`text-sm mt-0.5 ${
            callState === 'active' && duration >= WARN_CALL_SECONDS
              ? 'text-orange-400 font-semibold'
              : 'text-zinc-500'
          }`}>
            {callState === 'active'
              ? formatDuration(duration)
              : callState === 'connecting'
                ? 'Estableciendo conexión...'
                : callState === 'ended'
                  ? formatDuration(duration)
                  : canCall
                    ? 'Listo para practicar'
                    : 'Selecciona un tipo de práctica'}
          </p>
          {callState === 'active' && duration >= WARN_CALL_SECONDS && (
            <p className="text-xs text-orange-400/80 mt-0.5 animate-pulse">
              ⏱ Quedan {Math.ceil((MAX_CALL_SECONDS - duration) / 60)} min
            </p>
          )}
        </div>

        <div className="flex items-center justify-center h-36 px-6">
          {callState === 'active' ? (
            <AudioVisualizer
              frequencyData={microphone.frequencyData}
              isActive={microphone.isRecording}
              color={gemini.isModelSpeaking ? '#8b5cf6' : '#3b82f6'}
            />
          ) : callState === 'connecting' ? (
            <div className="h-24 w-24 rounded-full bg-blue-600/20 border-2 border-blue-500/40 flex items-center justify-center animate-pulse">
              <div className="h-16 w-16 rounded-full bg-blue-600/30 flex items-center justify-center animate-pulse">
                <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                </svg>
              </div>
            </div>
          ) : callState === 'ended' ? (
            <div className="h-24 w-24 rounded-full bg-green-600/20 border-2 border-green-500/40 flex items-center justify-center">
              <svg className="w-10 h-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          ) : (
            <div className="h-24 w-24 rounded-full bg-zinc-800 border-2 border-zinc-700 flex items-center justify-center">
              <svg className="w-10 h-10 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
              </svg>
            </div>
          )}
        </div>

        {callState === 'active' && lastText && (
          <div className="px-6 pb-2">
            <div className="bg-zinc-800/50 rounded-lg px-4 py-2 max-h-16 overflow-y-auto">
              <p className="text-xs text-zinc-400 truncate">{lastText}</p>
            </div>
          </div>
        )}

        {errorMessage && callState !== 'active' && (
          <div className="px-6 pb-2">
            <div className="bg-red-950/50 border border-red-800/50 rounded-lg px-4 py-3">
              <div className="flex items-start gap-2">
                <svg className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <p className="text-xs text-red-300 leading-relaxed">{errorMessage}</p>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-center gap-8 pb-10 pt-4">
          <button
            onClick={toggleMute}
            disabled={callState !== 'active'}
            className={`h-14 w-14 rounded-full flex items-center justify-center transition-colors disabled:opacity-30 ${
              isMuted ? 'bg-red-600/20 text-red-400' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            {isMuted ? (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.531v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              </svg>
            )}
          </button>

          {callState === 'active' || callState === 'connecting' ? (
            <button
              onClick={handleHangup}
              className="h-16 w-16 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center text-white transition-colors shadow-lg shadow-red-600/30"
            >
              <svg className="w-7 h-7 rotate-[135deg]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleCall}
              disabled={!canCall}
              className="h-16 w-16 rounded-full bg-green-600 hover:bg-green-700 flex items-center justify-center text-white transition-colors shadow-lg shadow-green-600/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
              </svg>
            </button>
          )}

          <button
            disabled={callState !== 'active'}
            className="h-14 w-14 rounded-full bg-zinc-800 text-zinc-400 hover:bg-zinc-700 flex items-center justify-center transition-colors disabled:opacity-30"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
