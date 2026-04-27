import { useRef, useState, useCallback } from 'react'

interface TranscriptEntry {
  role: 'user' | 'model'
  text: string
}

export type CallEndReason =
  | 'cierre_exitoso'
  | 'objeciones_no_resueltas'
  | 'sin_interes'
  | 'timeout'
  | 'manual'

interface UseGeminiLiveOptions {
  systemPrompt: string
  voiceName?: string
  onTranscript?: (entry: TranscriptEntry) => void
  onModelSpeaking?: (speaking: boolean) => void
  onError?: (error: string) => void
  // Se dispara cuando el modelo decide colgar la llamada (llamando la function
  // end_call). El PhoneUI debe reaccionar cerrando la llamada en la UI.
  onModelHangup?: (info: { reason: CallEndReason; summary?: string }) => void
}

interface UseGeminiLiveReturn {
  isConnected: boolean
  isModelSpeaking: boolean
  transcript: TranscriptEntry[]
  connect: () => Promise<void>
  disconnect: () => void
  sendAudio: (audioData: Float32Array) => void
}

function floatTo16BitPCM(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return int16
}

function int16ToFloat32(int16: Int16Array): Float32Array {
  const float32 = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768
  }
  return float32
}

function base64Encode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64Decode(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

// Cross-browser AudioContext (iOS Safari < 14 usa webkitAudioContext)
function getAudioContextClass(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext ||
    null
  )
}

// Sample rate del audio que devuelve Gemini Live (siempre 24kHz).
const GEMINI_OUTPUT_SAMPLE_RATE = 24000

export function useGeminiLive(options: UseGeminiLiveOptions): UseGeminiLiveReturn {
  const { systemPrompt, voiceName = 'Kore', onTranscript, onModelSpeaking, onError, onModelHangup } = options

  const [isConnected, setIsConnected] = useState(false)
  const [isModelSpeaking, setIsModelSpeaking] = useState(false)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])

  const wsRef = useRef<WebSocket | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const nextPlayTimeRef = useRef(0)
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const currentModelTextRef = useRef('')
  const currentUserTextRef = useRef('')

  // Session resumption state — Gemini Live corta sesiones tras un tiempo, pero emite
  // `sessionResumptionUpdate` con un handle que permite reconectar preservando contexto.
  const sessionHandleRef = useRef<string | null>(null)
  const isUserDisconnectingRef = useRef(false)
  const reconnectAttemptsRef = useRef(0)
  const wsUrlRef = useRef<string | null>(null)
  const modelPathRef = useRef<string>('models/gemini-3.1-flash-live-preview')

  // Estado para hangup iniciado por el modelo vía function call `end_call`.
  // Al recibir el toolCall, no cortamos inmediatamente: esperamos a que termine
  // de reproducirse el audio de despedida y entonces llamamos a onModelHangup.
  const pendingHangupRef = useRef<{ reason: CallEndReason; summary?: string } | null>(null)
  const onModelHangupRef = useRef(onModelHangup)
  onModelHangupRef.current = onModelHangup

  // Ref para la función de reconexión con token fresco. Se actualiza en cada render
  // para evitar closures stales dentro del ws.onclose de openSocket.
  const doReconnectRef = useRef<() => void>(() => {})

  const playAudioChunk = useCallback((pcmBase64: string) => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      // ⚠️ NO forzar sampleRate aquí: iOS Safari lo rechaza o lo ignora.
      // Creamos el contexto al sample rate nativo del dispositivo y dejamos
      // que el AudioBuffer (creado a 24kHz, el rate de Gemini) se resamplee
      // automáticamente al conectarse al destination.
      const AudioContextClass = getAudioContextClass()
      if (!AudioContextClass) {
        console.error('[gemini-live] Web Audio API no disponible')
        return
      }
      audioContextRef.current = new AudioContextClass()
    }

    const ctx = audioContextRef.current
    // En móviles, el AudioContext puede estar suspendido si la pantalla se apagó
    // o si llegó un audio antes de que el user gesture lo activara.
    if (ctx.state === 'suspended') {
      ctx.resume().catch((err) => console.warn('[gemini-live] resume() failed', err))
    }

    const pcmBuffer = base64Decode(pcmBase64)
    const int16Data = new Int16Array(pcmBuffer)
    const float32Data = int16ToFloat32(int16Data)

    // Creamos el buffer al sample rate de Gemini (24kHz). El navegador lo
    // resamplea al sample rate del contexto cuando se conecta a destination.
    // Esto funciona en Chrome/Firefox/Safari modernos (iOS 14.5+).
    const audioBuffer = ctx.createBuffer(1, float32Data.length, GEMINI_OUTPUT_SAMPLE_RATE)
    audioBuffer.getChannelData(0).set(float32Data)

    const source = ctx.createBufferSource()
    source.buffer = audioBuffer
    source.connect(ctx.destination)

    // Buffer de 20ms (antes 50ms). Reduce la latencia percibida entre que el
    // modelo termina de "pensar" y empieza a hablar. Si vemos glitches en el
    // audio podemos subirlo a 30ms.
    const startTime = Math.max(ctx.currentTime + 0.02, nextPlayTimeRef.current)
    source.start(startTime)
    nextPlayTimeRef.current = startTime + audioBuffer.duration

    activeSourcesRef.current.push(source)
    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source)
      if (activeSourcesRef.current.length === 0) {
        setIsModelSpeaking(false)
        onModelSpeaking?.(false)

        // Si el modelo pidió colgar (function call end_call) y ya terminó de
        // reproducirse toda la despedida, notificamos al UI para que cierre
        // la llamada "naturalmente".
        if (pendingHangupRef.current) {
          const info = pendingHangupRef.current
          pendingHangupRef.current = null
          onModelHangupRef.current?.(info)
        }
      }
    }
  }, [onModelSpeaking])

  const stopPlayback = useCallback(() => {
    activeSourcesRef.current.forEach((s) => {
      try { s.stop() } catch {}
    })
    activeSourcesRef.current = []
    nextPlayTimeRef.current = 0
    setIsModelSpeaking(false)
    onModelSpeaking?.(false)
  }, [onModelSpeaking])

  // openSocket abre un WebSocket nuevo con el setup. Si sessionHandleRef está poblado,
  // envía `sessionResumption: { handle }` para continuar la sesión anterior sin perder
  // el contexto de la conversación en curso.
  const openSocket = useCallback((url: string) => {
    const isResuming = sessionHandleRef.current !== null
    const ws = new WebSocket(url)

    ws.onopen = () => {
      console.log(
        `[gemini-live] ws.onopen — sending setup (${isResuming ? 'RESUMING with handle' : 'new session'})`
      )
      const setupMessage: Record<string, unknown> = {
        setup: {
          model: modelPathRef.current,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
              // languageCode NO se usa en modelos de audio nativo (gemini-live-2.5-flash-native-audio)
              // El modelo detecta el idioma automáticamente durante la conversación.
            },
          },
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          // Tuning del VAD del servidor: reducir silenceDurationMs hace que
          // Gemini detecte fin de habla más rápido (default ~700-800ms).
          // 400ms es un buen balance: no corta al usuario que hace pausas
          // cortas pero responde rápido cuando de verdad terminó.
          realtimeInputConfig: {
            automaticActivityDetection: {
              silenceDurationMs: 400,
              prefixPaddingMs: 100,
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          // Tool declaration: el modelo puede llamar end_call para colgar la
          // llamada cuando corresponda (cierre exitoso, sin interés, etc).
          // El prompt instruye cuándo usarla.
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'end_call',
                  description:
                    'Cuelga la llamada telefónica cuando la conversación ha terminado naturalmente. Úsala DESPUÉS de haber dicho verbalmente la despedida (ej. "Gracias, hasta luego"). Escenarios válidos: el vendedor cerró exitosamente la venta, el prospecto no tiene interés real, o la conversación ha concluido.',
                  parameters: {
                    type: 'OBJECT',
                    properties: {
                      reason: {
                        type: 'STRING',
                        enum: [
                          'cierre_exitoso',
                          'objeciones_no_resueltas',
                          'sin_interes',
                          'timeout',
                        ],
                        description:
                          'Motivo del cierre de la llamada: cierre_exitoso si el vendedor cerró la venta; objeciones_no_resueltas si te vas por objeciones sin resolver; sin_interes si nunca hubo match; timeout para otros cierres naturales.',
                      },
                      summary: {
                        type: 'STRING',
                        description:
                          'Resumen corto (1 oración) del resultado de la llamada.',
                      },
                    },
                    required: ['reason'],
                  },
                },
              ],
            },
          ],
          // Habilita session resumption — Gemini enviará handles periódicos en
          // `sessionResumptionUpdate` y permite reconectar preservando contexto.
          // Solo se envía el campo si hay un handle activo (sesiones nuevas no lo incluyen).
          ...(isResuming && sessionHandleRef.current
            ? { sessionResumption: { handle: sessionHandleRef.current } }
            : {}),
        },
      }
      ws.send(JSON.stringify(setupMessage))
    }

    ws.onmessage = async (event) => {
      let raw: string
      if (typeof event.data === 'string') {
        raw = event.data
      } else if (event.data instanceof Blob) {
        raw = await event.data.text()
      } else if (event.data instanceof ArrayBuffer) {
        raw = new TextDecoder().decode(event.data)
      } else {
        console.warn('[gemini-live] unexpected message type', event.data)
        return
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any
      try {
        data = JSON.parse(raw)
      } catch (err) {
        console.error('[gemini-live] JSON parse error', err, raw.slice(0, 200))
        return
      }

      if (data.setupComplete !== undefined) {
        console.log('[gemini-live] setupComplete — connected')
        setIsConnected(true)
        reconnectAttemptsRef.current = 0
        return
      }

      // Session resumption: Gemini emite un handle nuevo cada ~60s. Lo guardamos
      // para usarlo si la conexión se cae.
      if (data.sessionResumptionUpdate) {
        const upd = data.sessionResumptionUpdate
        if (upd.resumable && upd.newHandle) {
          sessionHandleRef.current = upd.newHandle
          console.log('[gemini-live] sessionResumptionUpdate — handle stored')
        }
      }

      // GoAway: Gemini avisa antes de cerrar. timeLeft suele ser ~30s.
      // Aprovechamos ese margen para pre-fetchear un token fresco, de modo que
      // cuando onclose dispare tengamos la URL lista y la reconexión sea instantánea.
      if (data.goAway) {
        console.warn('[gemini-live] goAway received — pre-fetching fresh token', data.goAway)
        fetch('/api/vertex/config')
          .then((r) => (r.ok ? r.json() : Promise.reject('goAway pre-fetch HTTP error')))
          .then(({ wsUrl, modelPath }: { wsUrl: string; modelPath: string }) => {
            wsUrlRef.current = wsUrl
            modelPathRef.current = modelPath
            console.log('[gemini-live] goAway: fresh token pre-fetched and ready')
          })
          .catch((err) =>
            console.warn('[gemini-live] goAway: pre-fetch failed (will retry on close)', err),
          )
      }

      // Function calling: el modelo pidió ejecutar una herramienta.
      // Por ahora solo soportamos `end_call`. Respondemos con un ack y
      // programamos el hangup para cuando termine de hablar.
      if (data.toolCall?.functionCalls) {
        const functionResponses: Array<{ id?: string; name: string; response: Record<string, unknown> }> = []
        for (const fc of data.toolCall.functionCalls) {
          if (fc.name === 'end_call') {
            const args = fc.args || {}
            const reason = (args.reason as CallEndReason) || 'timeout'
            const summary = typeof args.summary === 'string' ? args.summary : undefined
            console.log('[gemini-live] end_call received', { reason, summary })
            pendingHangupRef.current = { reason, summary }
            functionResponses.push({
              id: fc.id,
              name: 'end_call',
              response: { ok: true },
            })

            // Fallback: si no hay audio reproduciéndose (el modelo llamó
            // end_call sin despedirse), disparamos el hangup en ~800ms.
            if (activeSourcesRef.current.length === 0) {
              setTimeout(() => {
                if (pendingHangupRef.current) {
                  const info = pendingHangupRef.current
                  pendingHangupRef.current = null
                  onModelHangupRef.current?.(info)
                }
              }, 800)
            }
          } else {
            // Función desconocida: respondemos con error para que el modelo se entere.
            functionResponses.push({
              id: fc.id,
              name: fc.name,
              response: { error: 'unknown function' },
            })
          }
        }
        if (functionResponses.length > 0 && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ toolResponse: { functionResponses } }))
        }
      }

      if (data.serverContent) {
        const sc = data.serverContent
        const { modelTurn, turnComplete } = sc

        if (modelTurn?.parts) {
          for (const part of modelTurn.parts) {
            if (part.inlineData?.mimeType?.startsWith('audio/')) {
              if (!isModelSpeaking) {
                setIsModelSpeaking(true)
                onModelSpeaking?.(true)
              }
              playAudioChunk(part.inlineData.data)
            }
            if (part.text) {
              currentModelTextRef.current += part.text
            }
          }
        }

        const inputTr = sc.inputTranscription
        if (inputTr?.text) {
          currentUserTextRef.current += inputTr.text
        }
        if (inputTr?.finished && currentUserTextRef.current) {
          const entry: TranscriptEntry = { role: 'user', text: currentUserTextRef.current.trim() }
          setTranscript((prev) => [...prev, entry])
          onTranscript?.(entry)
          currentUserTextRef.current = ''
        }

        const outputTr = sc.outputTranscription
        if (outputTr?.text) {
          currentModelTextRef.current += outputTr.text
        }

        if (turnComplete) {
          if (currentUserTextRef.current) {
            const entry: TranscriptEntry = { role: 'user', text: currentUserTextRef.current.trim() }
            setTranscript((prev) => [...prev, entry])
            onTranscript?.(entry)
            currentUserTextRef.current = ''
          }
          if (currentModelTextRef.current) {
            const entry: TranscriptEntry = { role: 'model', text: currentModelTextRef.current.trim() }
            setTranscript((prev) => [...prev, entry])
            onTranscript?.(entry)
            currentModelTextRef.current = ''
          }
        }
      }
    }

    ws.onerror = (ev) => {
      console.error('[gemini-live] ws.onerror', ev)
    }

    ws.onclose = (ev) => {
      console.warn(
        `[gemini-live] ws.onclose code=${ev.code} wasClean=${ev.wasClean} reason="${ev.reason || '(empty)'}"`
      )
      setIsConnected(false)

      // Si fue cierre intencional del usuario, no reconectar.
      if (isUserDisconnectingRef.current) {
        stopPlayback()
        return
      }

      // Intento de reconexión automática si tenemos un handle (session resumption).
      // Backoff lineal y tope de 3 intentos para no loopear infinitamente.
      if (sessionHandleRef.current && reconnectAttemptsRef.current < 3) {
        reconnectAttemptsRef.current += 1
        const delayMs = 500 * reconnectAttemptsRef.current
        console.log(
          `[gemini-live] attempting resume #${reconnectAttemptsRef.current} with fresh token in ${delayMs}ms`
        )
        // Siempre pedimos un token fresco — el token anterior puede haber expirado
        // (el OIDC token de Vercel tiene ~2 min de vida, lo que limita el access token de GCP).
        setTimeout(() => {
          if (!isUserDisconnectingRef.current) {
            doReconnectRef.current()
          }
        }, delayMs)
      } else {
        // Sin handle o agotados los intentos: cerramos realmente.
        stopPlayback()
        if (!sessionHandleRef.current) {
          onError?.('La conexión con Gemini se cerró')
        } else {
          onError?.('No se pudo reconectar con Gemini')
        }
      }
    }

    wsRef.current = ws
  }, [voiceName, systemPrompt, onTranscript, onModelSpeaking, onError, playAudioChunk, stopPlayback, isModelSpeaking])

  // Obtiene un token fresco de /api/vertex/config y abre un nuevo socket preservando
  // el sessionHandle para que Gemini retome la conversación desde donde se cortó.
  // Se accede siempre vía doReconnectRef para evitar closures stales en openSocket.
  const doReconnect = useCallback(() => {
    if (isUserDisconnectingRef.current) return
    console.log(`[gemini-live] fetching fresh token for reconnect #${reconnectAttemptsRef.current}`)
    fetch('/api/vertex/config')
      .then((r) => {
        if (!r.ok) return r.json().then((d: { error?: string }) => { throw new Error(d.error ?? 'Token refresh failed') })
        return r.json()
      })
      .then(({ wsUrl, modelPath }: { wsUrl: string; modelPath: string }) => {
        if (isUserDisconnectingRef.current) return
        wsUrlRef.current = wsUrl
        modelPathRef.current = modelPath
        console.log('[gemini-live] fresh token obtained — opening socket with session handle')
        openSocket(wsUrl)
      })
      .catch((err: unknown) => {
        console.error('[gemini-live] token refresh failed on reconnect', err)
        stopPlayback()
        onError?.('No se pudo reconectar con Gemini. Intenta iniciar una nueva llamada.')
      })
  }, [openSocket, stopPlayback, onError])
  doReconnectRef.current = doReconnect

  const connect = useCallback(async () => {
    try {
      // Reset state para una nueva sesión
      isUserDisconnectingRef.current = false
      sessionHandleRef.current = null
      reconnectAttemptsRef.current = 0
      pendingHangupRef.current = null

      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        // NO forzar sampleRate (iOS Safari lo rechaza). Usamos el rate nativo
        // y los buffers de 24kHz se resamplean automáticamente al destination.
        const AudioContextClass = getAudioContextClass()
        if (!AudioContextClass) {
          throw new Error('Tu navegador no soporta Web Audio API')
        }
        audioContextRef.current = new AudioContextClass()
      }
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume()
      }
      console.log(
        `[gemini-live] playback AudioContext state=${audioContextRef.current.state}, sampleRate=${audioContextRef.current.sampleRate}Hz`,
      )

      const res = await fetch('/api/vertex/config')
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Error conectando con Vertex AI' }))
        throw new Error(error ?? 'Failed to get Vertex AI config')
      }
      const { wsUrl, modelPath } = await res.json()
      wsUrlRef.current = wsUrl
      modelPathRef.current = modelPath

      openSocket(wsUrl)
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Error conectando con Gemini')
    }
  }, [openSocket, onError])

  const disconnect = useCallback(() => {
    isUserDisconnectingRef.current = true
    sessionHandleRef.current = null
    reconnectAttemptsRef.current = 0
    wsUrlRef.current = null
    pendingHangupRef.current = null
    stopPlayback()
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    audioContextRef.current?.close()
    audioContextRef.current = null
    setIsConnected(false)
    setTranscript([])
    currentModelTextRef.current = ''
    currentUserTextRef.current = ''
  }, [stopPlayback])

  const sendAudio = useCallback((audioData: Float32Array) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return

    const pcm = floatTo16BitPCM(audioData)
    const base64 = base64Encode(pcm.buffer as ArrayBuffer)

    wsRef.current.send(JSON.stringify({
      realtimeInput: {
        audio: {
          mimeType: 'audio/pcm;rate=16000',
          data: base64,
        },
      },
    }))
  }, [])

  return { isConnected, isModelSpeaking, transcript, connect, disconnect, sendAudio }
}
