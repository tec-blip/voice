'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useMicrophone } from '@/lib/hooks/use-microphone'
import { useGeminiLive, type CallEndReason } from '@/lib/hooks/use-gemini-live'
import { AudioVisualizer } from './audio-visualizer'
import type { RoleplayType } from '@/lib/prompts/roleplay'
import { getRoleplayPrompt } from '@/lib/prompts/roleplay'
import {
  isHardCapReached,
  isWarningWindow,
  minutesRemaining,
} from '@/lib/engine'

type CallState = 'idle' | 'connecting' | 'active' | 'dropped' | 'ended'

interface PhoneUIProps {
  roleplayType: RoleplayType | null
  systemPromptOverride?: string
  voiceName?: string
  onCallEnd?: (
    transcript: { role: 'user' | 'model'; text: string }[],
    durationSeconds: number,
    meta?: { endedBy: 'user' | 'model'; reason?: CallEndReason; summary?: string; events?: unknown[] }
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
  // Aviso híbrido: el modelo señaló un cierre exitoso maduro (venta cerrada).
  // NO cuelga la llamada — solo invita al alumno a colgar para ver su evaluación.
  const [saleClosed, setSaleClosed] = useState(false)
  // Indicador "Reconectando…": se muestra SOLO si la reconexión tarda (>1.2s),
  // para no parpadear en los cruces instantáneos del límite de ~10 min.
  const [showReconnecting, setShowReconnecting] = useState(false)

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

  // Id de la sesión reservada en /api/sessions/start (control de costo/concurrencia).
  const sessionIdRef = useRef<string | null>(null)
  // Guarda de idempotencia: evita doble onCallEnd/guardado si finalizeCall corre
  // más de una vez.
  const endedRef = useRef(false)
  // Limpieza de recursos para rutas de ERROR (sin evaluar): detiene mic, cierra
  // WS y libera la reserva de sesión. Se asigna abajo (usa gemini/microphone).
  const cleanupRef = useRef<() => void>(() => {})

  const gemini = useGeminiLive({
    systemPrompt,
    voiceName: voiceName ?? 'Kore',
    roleplayType: roleplayType ?? undefined,
    onTranscript: useCallback((entry: { role: 'user' | 'model'; text: string }) => {
      setLastText(entry.text)
    }, []),
    onError: useCallback((error: string) => {
      console.error('Gemini error:', error)
      cleanupRef.current()
      setErrorMessage(error)
      setCallState('idle')
    }, []),
    onModelHangup: useCallback((info: { reason: CallEndReason; summary?: string }) => {
      // El gating del end_call (piso mínimo por tipo + reason permitido por modo)
      // ya ocurrió en el hook (engine/call-lifecycle). Aquí solo cerramos la UI.
      console.log('[phone-ui] model requested hangup', info)
      finalizeCallRef.current({ endedBy: 'model', reason: info.reason, summary: info.summary })
    }, []),
    onConnectionLost: useCallback(() => {
      // La reconexión automática se agotó pero la sesión es reanudable.
      // Pasamos a 'dropped' para ofrecer "Reanudar" sin perder la llamada.
      console.warn('[phone-ui] connection lost — offering resume')
      setCallState('dropped')
    }, []),
    onSaleClosed: useCallback(() => {
      // La venta se cerró (cierre maduro). Mostramos el aviso; el alumno decide
      // cuándo colgar. NO terminamos la llamada automáticamente.
      console.log('[phone-ui] sale closed — showing hint')
      setSaleClosed(true)
    }, []),
  })

  const microphone = useMicrophone({
    onAudioData: useCallback((data: Float32Array) => {
      // Half-duplex: NO enviar audio del micrófono mientras el modelo habla.
      // El AEC del navegador no cancela el audio que reproducimos por Web Audio,
      // así que en altavoz el mic captaba la voz del modelo y la reenviaba como
      // falso barge-in (desincronizaba turnos y disparaba "Adiós" prematuros).
      // También respeta el botón mute (que antes era solo cosmético).
      if (isMuted || gemini.isModelSpeaking) return
      gemini.sendAudio(data)
    }, [gemini, isMuted]),
    onError: useCallback((error: string) => {
      console.error('Microphone error:', error)
      cleanupRef.current()
      setErrorMessage(error)
      setCallState('idle')
    }, []),
  })

  // Límites de duración por sesión: única fuente de verdad en engine/call-lifecycle
  // (MAX_CALL_SECONDS / WARN_CALL_SECONDS importados arriba).

  useEffect(() => {
    if (callState !== 'active') return
    const interval = setInterval(() => setDuration((d) => d + 1), 1000)
    return () => clearInterval(interval)
  }, [callState])

  // Auto-hangup al alcanzar el cap duro de la sesión (determinista, sin LLM)
  useEffect(() => {
    if (callState !== 'active') return
    if (isHardCapReached(duration)) {
      finalizeCallRef.current({ endedBy: 'model', reason: 'timeout' })
    }
  }, [duration, callState])

  // Heartbeat para mantener viva la reserva de sesión durante la llamada.
  // También en 'dropped': la reserva sigue abierta para poder Reanudar, así que
  // debemos evitar que el reaper la cierre mientras el usuario decide.
  useEffect(() => {
    if (callState !== 'active' && callState !== 'dropped') return
    const id = setInterval(() => {
      const sid = sessionIdRef.current
      if (!sid) return
      fetch('/api/sessions/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid }),
      }).catch(() => {})
    }, 30_000)
    return () => clearInterval(id)
  }, [callState])

  // "Reconectando…" con retardo: solo se muestra si la reconexión tarda >1.2s
  // (así los cruces instantáneos del límite de ~10 min no hacen parpadear nada).
  useEffect(() => {
    if (!gemini.isReconnecting) {
      setShowReconnecting(false)
      return
    }
    const t = setTimeout(() => setShowReconnecting(true), 1200)
    return () => clearTimeout(t)
  }, [gemini.isReconnecting])

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
    setSaleClosed(false)
    endedRef.current = false
    setCallState('connecting')

    // Reserva de sesión (control de costo + concurrencia) ANTES de conectar.
    // Si el backend no está configurado, responde { sessionId: null } y no bloquea.
    try {
      const startRes = await fetch('/api/sessions/start', { method: 'POST' })
      if (!startRes.ok) {
        const info = await startRes.json().catch(() => ({}))
        setErrorMessage(info.error || 'No se pudo iniciar la llamada.')
        setCallState('idle')
        return
      }
      const info = await startRes.json().catch(() => ({}))
      sessionIdRef.current = typeof info.sessionId === 'string' ? info.sessionId : null
    } catch {
      sessionIdRef.current = null // fallo de red: no bloqueamos la práctica
    }

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
      // Idempotencia por ref (no dentro del updater de setState: React puede
      // re-ejecutar el updater y disparaba doble evaluación/guardado).
      if (endedRef.current) return
      endedRef.current = true

      const finalTranscript = gemini.transcript
      const finalDuration = durationRef.current
      // Eventos de ciclo de vida + marca de cierre, para diagnóstico.
      const events = [
        ...gemini.getEvents(),
        { t: Date.now(), type: 'ended', detail: { endedBy: meta.endedBy, reason: meta.reason } },
      ]
      microphone.stop()
      gemini.disconnect()
      // Cerrar la reserva de sesión y conciliar la cuota (best-effort).
      const sid = sessionIdRef.current
      if (sid) {
        fetch('/api/sessions/end', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sid, actualSeconds: finalDuration }),
        }).catch(() => {})
        sessionIdRef.current = null
      }
      setCallState('ended')
      setTimeout(() => onCallEnd?.(finalTranscript, finalDuration, { ...meta, events }), 0)
    },
    [microphone, gemini, onCallEnd]
  )
  finalizeCallRef.current = finalizeCall

  // Limpieza para rutas de ERROR: libera recursos y la reserva SIN evaluar ni
  // guardar (una conexión fallida no es una práctica). Idempotente con finalizeCall.
  cleanupRef.current = () => {
    if (endedRef.current) return
    endedRef.current = true
    microphone.stop()
    gemini.disconnect()
    const sid = sessionIdRef.current
    if (sid) {
      fetch('/api/sessions/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, actualSeconds: durationRef.current }),
      }).catch(() => {})
      sessionIdRef.current = null
    }
  }

  // Reanudar una llamada caída: vuelve a 'connecting'; el efecto de isConnected
  // la promueve a 'active' al reconectar (preservando transcript y duración).
  const handleResume = useCallback(async () => {
    setErrorMessage(null)
    setCallState('connecting')
    // REINICIA el micrófono antes de reanudar. Lo que cortó la llamada (una
    // interrupción, otra app tomando el micro, la pantalla) suele dejar el
    // pipeline del micro MUERTO (AudioContext suspendido o tracks 'ended'). Si
    // solo reconectáramos el WebSocket, la IA volvería pero NO te oiría
    // ("¿aló? no se oye…") — reportado por testers. Un micro fresco lo garantiza.
    microphone.stop()
    const stream = await microphone.start()
    if (!stream) {
      // No se pudo recuperar el micro (permiso/otra app): volvemos a 'dropped'
      // para que el usuario reintente o termine, en vez de reconectar sin voz.
      setCallState('dropped')
      return
    }
    gemini.resume()
  }, [gemini, microphone])

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
            gemini.isModelSpeaking ? 'bg-red-600/20 ring-2 ring-red-500/40' : 'bg-zinc-700'
          } transition-all`}>
            <svg className={`w-6 h-6 ${gemini.isModelSpeaking ? 'text-red-400' : 'text-zinc-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
          <p className="text-white font-semibold mt-3">
            {callState === 'idle' ? 'Prospecto IA'
              : callState === 'connecting' ? 'Conectando...'
              : callState === 'dropped' ? 'Conexión perdida'
              : callState === 'ended' ? 'Llamada finalizada'
              : showReconnecting ? 'Reconectando…'
              : gemini.isModelSpeaking ? 'Hablando...' : 'Escuchando...'}
          </p>
          <p className={`text-sm mt-0.5 ${
            callState === 'active' && isWarningWindow(duration)
              ? 'text-orange-400 font-semibold'
              : 'text-zinc-500'
          }`}>
            {callState === 'active'
              ? formatDuration(duration)
              : callState === 'connecting'
                ? 'Estableciendo conexión...'
                : callState === 'dropped'
                  ? `Se cortó en ${formatDuration(duration)}`
                  : callState === 'ended'
                    ? formatDuration(duration)
                    : canCall
                      ? 'Listo para practicar'
                      : 'Selecciona un tipo de práctica'}
          </p>
          {callState === 'active' && isWarningWindow(duration) && (
            <p className="text-xs text-orange-400/80 mt-0.5 animate-pulse">
              ⏱ Quedan {minutesRemaining(duration)} min
            </p>
          )}
        </div>

        <div className="flex items-center justify-center h-36 px-6">
          {callState === 'active' ? (
            <AudioVisualizer
              frequencyData={microphone.frequencyData}
              isActive={microphone.isRecording}
              color={gemini.isModelSpeaking ? '#dc2626' : '#ef4444'}
            />
          ) : callState === 'connecting' ? (
            <div className="h-24 w-24 rounded-full bg-red-600/20 border-2 border-red-500/40 flex items-center justify-center animate-pulse">
              <div className="h-16 w-16 rounded-full bg-red-600/30 flex items-center justify-center animate-pulse">
                <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                </svg>
              </div>
            </div>
          ) : callState === 'dropped' ? (
            <div className="h-24 w-24 rounded-full bg-orange-600/20 border-2 border-orange-500/40 flex items-center justify-center">
              <svg className="w-10 h-10 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
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

        {callState === 'active' && showReconnecting && (
          <div className="px-6 pb-2">
            <div className="bg-amber-950/40 border border-amber-800/50 rounded-lg px-4 py-3 flex items-center gap-3">
              <div className="h-4 w-4 rounded-full border-2 border-amber-700 border-t-amber-300 animate-spin flex-shrink-0" />
              <p className="text-xs text-amber-200 leading-relaxed">
                Recuperando la llamada… <span className="font-semibold">no cuelgues</span>, sigue en un momento.
              </p>
            </div>
          </div>
        )}

        {callState === 'active' && saleClosed && (
          <div className="px-6 pb-2">
            <div className="bg-green-950/40 border border-green-800/50 rounded-lg px-4 py-3">
              <p className="text-xs text-green-200 leading-relaxed">
                ✅ <span className="font-semibold">Venta cerrada.</span> Cuando quieras, pulsa el botón rojo para colgar y ver tu evaluación.
              </p>
            </div>
          </div>
        )}

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

        {callState === 'dropped' && (
          <div className="px-6 pb-2">
            <div className="bg-orange-950/40 border border-orange-800/50 rounded-lg px-4 py-3">
              <p className="text-xs text-orange-200 leading-relaxed">
                Se cortó la conexión. Puedes <span className="font-semibold">reanudar</span> desde donde quedó, o terminar y ver tu evaluación.
              </p>
            </div>
          </div>
        )}

        {callState === 'dropped' ? (
          <div className="flex items-center justify-center gap-4 pb-10 pt-4">
            <button
              onClick={handleResume}
              className="rounded-xl bg-green-600 hover:bg-green-700 px-7 py-3 text-sm font-semibold text-white transition-colors shadow-lg shadow-green-600/30"
            >
              Reanudar
            </button>
            <button
              onClick={handleHangup}
              className="rounded-xl bg-zinc-800 hover:bg-zinc-700 px-7 py-3 text-sm font-semibold text-zinc-200 transition-colors"
            >
              Terminar
            </button>
          </div>
        ) : (
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
        )}
      </div>
    </div>
  )
}
