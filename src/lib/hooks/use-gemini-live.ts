import { useRef, useState, useCallback } from 'react'
import { canModelEndCall, canModelUseReason, isMatureClose, type CallEndReason, type CallType } from '@/lib/engine'

// Re-exportado para compatibilidad: el tipo canónico vive en la capa-motor
// (engine/types) para que no dependa de React.
export type { CallEndReason }

// Respuesta a la función end_call cuando lo bloqueamos (corte demasiado temprano).
const STEER_CONTINUE_MSG =
  'Todavía no es momento de colgar. La conversación debe continuar: sigue en tu personaje y deja que el vendedor dirija la llamada.'

// Respuesta cuando bloqueamos un end_call por 'cierre_exitoso' del modelo en arco
// completo: el cierre lo declara el vendedor colgando, no el prospecto. Que hayas
// aceptado NO es motivo para colgar — hay que dejar que el vendedor presente y cierre.
const STEER_CLOSE_MSG =
  'El cierre lo marca el vendedor, no tú. Aunque estés de acuerdo, NO cuelgues: pide el siguiente paso concreto y deja que el vendedor te explique cómo funciona, el precio y cierre él la llamada.'

// Turno de cliente que INYECTAMOS tras bloquear un end_call para forzar que el
// modelo vuelva a hablar (si solo respondiéramos a la función, a veces se queda
// mudo esperando colgar). Esto garantiza que nunca quede la llamada en silencio.
const REENGAGE_PROMPT =
  '(El vendedor sigue en la llamada y espera tu respuesta. Continúa la conversación con naturalidad: haz un comentario o una pregunta, en español. NO cuelgues ni te despidas todavía.)'

// Re-enganche específico cuando el modelo intentó cerrar sobre un "sí": lo
// empujamos a exigir el pitch/siguiente paso en vez de despedirse.
const REENGAGE_CLOSE_PROMPT =
  '(Acabas de mostrar interés, pero la llamada NO ha terminado. Como cliente real, pide al vendedor el siguiente paso concreto: pregúntale cómo funciona, el precio o cómo empezar. En español. NO cuelgues ni te despidas.)'

// Re-enganche cuando la venta YA se cerró de forma MADURA (tras el pitch, pasado
// el piso de tiempo): el prospecto confirma brevemente y deja de llevar la
// conversación. Sigue sin colgar (el vendedor cuelga) — el aviso "venta cerrada"
// se lo mostramos al alumno vía onSaleClosed.
const REENGAGE_CLOSE_DONE_PROMPT =
  '(La venta ya quedó cerrada y lo confirmaste. NO generes preguntas nuevas ni alargues la llamada; responde breve y natural SOLO si el vendedor dice algo. En español. NO cuelgues: el vendedor cierra la llamada.)'
const STEER_CLOSE_DONE_MSG =
  'La venta quedó cerrada. No cuelgues tú: confirma brevemente ("perfecto, quedamos así, quedo atento") y deja que el vendedor cierre y cuelgue. No sigas generando preguntas nuevas.'

// Dead-air: si el vendedor terminó su turno y el prospecto se queda mudo más de
// este tiempo (sin responder, sin audio, sin que el usuario siga hablando), le
// inyectamos un empujón para que retome. Conservador para no cortar pausas
// naturales: la latencia normal del modelo es de 1-3s.
const DEAD_AIR_MS = 10_000

// Empujón de ARRANQUE: si tras conectar el prospecto no abre la llamada (en arco
// completo el modelo saluda primero) y nadie habla, lo activamos para que dé su
// primera frase. Semánticamente distinto al re-enganche de mitad de conversación.
const KICKOFF_NUDGE_PROMPT =
  '(La llamada acaba de empezar y hay silencio. Abre tú en tu personaje de cliente con tu primera frase, en español, breve y natural. NO cuelgues.)'

interface TranscriptEntry {
  role: 'user' | 'model'
  text: string
}

// Evento de ciclo de vida de la llamada — para diagnóstico (se persiste en la
// sesión). Permite ver QUÉ pasó (caídas, reconexiones, end_call) en vez de deducir.
export interface CallEvent {
  t: number
  type: string
  detail?: Record<string, unknown>
}

interface UseGeminiLiveOptions {
  systemPrompt: string
  voiceName?: string
  // Tipo de práctica — gobierna el piso mínimo de duración y qué reasons puede
  // usar el modelo para autocolgar (ver engine/call-lifecycle).
  roleplayType?: CallType
  onTranscript?: (entry: TranscriptEntry) => void
  onModelSpeaking?: (speaking: boolean) => void
  onError?: (error: string) => void
  // Se dispara cuando el modelo decide colgar la llamada (llamando la function
  // end_call). El PhoneUI debe reaccionar cerrando la llamada en la UI.
  onModelHangup?: (info: { reason: CallEndReason; summary?: string }) => void
  // Se dispara cuando la conexión se cayó y la reconexión automática se agotó,
  // PERO hay un sessionHandle → la llamada se puede REANUDAR (resume()).
  onConnectionLost?: () => void
  // Se dispara (una vez por llamada) cuando el modelo señala un cierre EXITOSO
  // maduro en arco completo — la venta se cerró tras el pitch. NO cuelga la
  // llamada (el vendedor cuelga); solo permite avisar al alumno que ya puede
  // colgar para ver su evaluación. En 'objeciones' no aplica.
  onSaleClosed?: () => void
}

interface UseGeminiLiveReturn {
  isConnected: boolean
  isModelSpeaking: boolean
  isReconnecting: boolean
  transcript: TranscriptEntry[]
  connect: () => Promise<void>
  disconnect: () => void
  resume: () => void
  sendAudio: (audioData: Float32Array) => void
  getEvents: () => CallEvent[]
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

// Parsea el `timeLeft` de un goAway (p.ej. "57s", "10.000s") a segundos.
function parseTimeLeftSeconds(v: unknown, fallback = 20): number {
  if (typeof v === 'number' && isFinite(v)) return v
  if (typeof v === 'string') {
    const m = v.match(/([\d.]+)/)
    if (m) {
      const n = parseFloat(m[1])
      if (!isNaN(n)) return n
    }
  }
  return fallback
}

export function useGeminiLive(options: UseGeminiLiveOptions): UseGeminiLiveReturn {
  const { systemPrompt, voiceName = 'Kore', roleplayType, onTranscript, onModelSpeaking, onError, onModelHangup, onConnectionLost, onSaleClosed } = options

  const [isConnected, setIsConnected] = useState(false)
  const [isModelSpeaking, setIsModelSpeaking] = useState(false)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  // true mientras se está reconectando (cruce del límite de ~10 min o caída
  // recuperable). La UI puede mostrar "Reconectando…" solo si el cruce tarda.
  const [isReconnecting, setIsReconnecting] = useState(false)

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
  // Default alineado con el modelo real que sirve /api/vertex/config. En el flujo
  // normal modelPath llega del endpoint y sobrescribe esto; el default solo aplica
  // si una reconexión no logró leer modelPath — debe ser el mismo modelo, no otro.
  const modelPathRef = useRef<string>('models/gemini-live-2.5-flash-native-audio')

  // Estado para hangup iniciado por el modelo vía function call `end_call`.
  // Al recibir el toolCall, no cortamos inmediatamente: esperamos a que termine
  // de reproducirse el audio de despedida y entonces llamamos a onModelHangup.
  const pendingHangupRef = useRef<{ reason: CallEndReason; summary?: string } | null>(null)
  const onModelHangupRef = useRef(onModelHangup)
  onModelHangupRef.current = onModelHangup

  // Cierre exitoso maduro (arco completo): se avisa al UI una sola vez por llamada.
  const onSaleClosedRef = useRef(onSaleClosed)
  onSaleClosedRef.current = onSaleClosed
  const saleClosedFiredRef = useRef(false)

  // Watchdog de dead-air: timer one-shot armado cuando el vendedor terminó su
  // turno y el prospecto aún no responde. Se limpia cuando el modelo habla o el
  // usuario retoma. Vive en un ref para poder limpiarlo desde cualquier handler.
  const deadAirTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Momento de conexión (ref): el handler de end_call (en ws.onmessage) lo lee
  // para gatear un end_call prematuro contra el piso mínimo por tipo (engine).
  // roleplayType se captura por closure en openSocket (es constante durante la
  // llamada), evitando un ref mutado en render.
  const connectedAtRef = useRef<number | null>(null)

  // Ref para la función de reconexión con token fresco. Se actualiza en cada render
  // para evitar closures stales dentro del ws.onclose de openSocket.
  const doReconnectRef = useRef<() => void>(() => {})

  // Listener de visibilitychange registrado durante la llamada.
  // Lo guardamos en un ref para poder retirarlo en disconnect().
  const visibilityListenerRef = useRef<(() => void) | null>(null)

  // Timer de reconexión proactiva programado al recibir un goAway. Reconectamos
  // ANTES de que Gemini cierre la sesión (~límite de 10 min) para que la llamada
  // cruce el límite sin corte y el modelo nunca use el fin de sesión como señal
  // para colgar. Se limpia en disconnect()/connect().
  const goAwayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Registro de eventos de ciclo de vida (diagnóstico). Se escribe SOLO desde
  // handlers/efectos (nunca en render), así que no viola las reglas de refs.
  const eventsRef = useRef<CallEvent[]>([])
  const logEvent = useCallback((type: string, detail?: Record<string, unknown>) => {
    eventsRef.current.push({ t: Date.now(), type, ...(detail ? { detail } : {}) })
    console.log(`[gemini-live][evt] ${type}`, detail ?? '')
  }, [])

  // ── Watchdog de dead-air ────────────────────────────────────────────────────
  const clearDeadAir = useCallback(() => {
    if (deadAirTimerRef.current) {
      clearTimeout(deadAirTimerRef.current)
      deadAirTimerRef.current = null
    }
  }, [])

  // Arma un empujón one-shot: si tras DEAD_AIR_MS el prospecto sigue mudo (y no
  // hay audio del modelo, ni hangup en curso, ni desconexión), inyecta un turno
  // que lo obliga a retomar. Reusa REENGAGE_PROMPT (mismo espíritu que el
  // re-enganche tras bloquear un end_call). Se re-arma en cada turno del usuario.
  const armDeadAir = useCallback((nudgeMsg: string = REENGAGE_PROMPT) => {
    clearDeadAir()
    deadAirTimerRef.current = setTimeout(() => {
      deadAirTimerRef.current = null
      if (isUserDisconnectingRef.current) return
      if (pendingHangupRef.current) return
      // Venta ya cerrada: NO reabrimos la conversación (el banner invita a colgar).
      if (saleClosedFiredRef.current) return
      if (activeSourcesRef.current.length > 0) return // el modelo está hablando
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      logEvent('dead_air_nudge')
      ws.send(JSON.stringify({
        clientContent: {
          turns: [{ role: 'user', parts: [{ text: nudgeMsg }] }],
          turnComplete: true,
        },
      }))
    }, DEAD_AIR_MS)
  }, [clearDeadAir, logEvent])

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
    // Nullificamos onended ANTES de stop() para que no disparen el hangup
    // de pendingHangupRef cuando el audio se corta abruptamente (por ejemplo
    // cuando el usuario interrumpe al modelo o al desconectar).
    activeSourcesRef.current.forEach((s) => {
      s.onended = null
      try { s.stop() } catch {}
    })
    activeSourcesRef.current = []
    nextPlayTimeRef.current = 0
    setIsModelSpeaking(false)
    onModelSpeaking?.(false)
  }, [onModelSpeaking])

  // Se agotó la reconexión automática. Si HAY sessionHandle, la conversación se
  // puede reanudar → avisamos al UI (onConnectionLost) para ofrecer "Reanudar".
  // Si no hay handle, es un cierre real → error.
  const giveUp = useCallback(() => {
    setIsReconnecting(false) // se agotó la reconexión → deja de mostrar "Reconectando…"
    stopPlayback()
    if (sessionHandleRef.current) {
      logEvent('connection_lost', { resumable: true })
      onConnectionLost?.()
    } else {
      logEvent('closed_no_handle')
      onError?.('La conexión con Gemini se cerró')
    }
  }, [stopPlayback, onError, onConnectionLost, logEvent])

  // openSocket abre un WebSocket nuevo con el setup. Si sessionHandleRef está poblado,
  // envía `sessionResumption: { handle }` para continuar la sesión anterior sin perder
  // el contexto de la conversación en curso.
  const openSocket = useCallback((url: string) => {
    // Limpia cualquier watchdog pendiente ANTES de (re)abrir: cubre en un solo
    // punto la conexión inicial, la reconexión por goAway (proactive resume), la
    // de visibilitychange y el resume manual. Evita que un timer armado en la
    // conexión vieja dispare un nudge sobre el socket nuevo tras reconectar.
    clearDeadAir()
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
          // Tuning del VAD del servidor. 400ms resultó DEMASIADO agresivo para
          // español LATAM conversacional (pausas naturales de 500-700ms entre
          // cláusulas: "pues...", "o sea..."): cortaba al usuario a media frase y
          // el modelo "saltaba" de turno. 700ms es el balance correcto.
          realtimeInputConfig: {
            automaticActivityDetection: {
              silenceDurationMs: 700,
              prefixPaddingMs: 250,
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
          // Session resumption: SIEMPRE enviamos el campo. En una sesión nueva va
          // VACÍO ({}) — ese es el opt-in que hace que Gemini EMPIECE a emitir
          // handles (sessionResumptionUpdate); al reconectar mandamos { handle }
          // para retomar el contexto.
          // BUG previo: solo se enviaba al reconectar → Gemini nunca emitía handles
          // → sessionHandle quedaba null → la reconexión automática y el "Reanudar"
          // nunca funcionaban y las llamadas largas cortaban con "error de Gemini".
          sessionResumption: sessionHandleRef.current
            ? { handle: sessionHandleRef.current }
            : {},
          // Compresión de ventana de contexto (sliding window). SIN esto, una
          // sesión de solo-audio se corta a los ~15 min al llenarse la ventana de
          // 128k tokens (el "muro" que tiraba las llamadas largas). CON esto,
          // Gemini compacta automáticamente el contexto viejo cuando se acerca al
          // límite y la sesión puede durar indefinidamente. Efecto secundario: el
          // modelo puede perder detalles MUY antiguos de la llamada (no corta ni
          // falla). Forma mínima documentada; triggerTokens es afinable si se
          // quiere que compacte antes.
          contextWindowCompression: {
            slidingWindow: {},
          },
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
        logEvent('setup_complete', { resuming: isResuming })
        setIsConnected(true)
        setIsReconnecting(false) // reconexión (o conexión) lograda → ocultar aviso
        reconnectAttemptsRef.current = 0
        // Marca el inicio de la llamada (solo la primera vez; una reconexión por
        // session-resumption NO reinicia el reloj del piso mínimo de duración).
        if (!connectedAtRef.current) connectedAtRef.current = Date.now()
        // Cobertura de dead-air en el ARRANQUE (solo conexión nueva, no resume):
        // si el prospecto no abre la llamada en DEAD_AIR_MS, lo empujamos. En una
        // reconexión la conversación ya venía en curso, así que no armamos aquí.
        if (!isResuming) armDeadAir(KICKOFF_NUDGE_PROMPT)
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

      // GoAway: Gemini avisa que va a cerrar la sesión (~límite de 10 min del
      // modelo native-audio). timeLeft suele ser decenas de segundos.
      // Estrategia: (1) pre-fetch de token fresco para que la reconexión sea
      // instantánea; (2) RECONEXIÓN PROACTIVA unos segundos antes del cierre,
      // usando el handle de resumption. Así la conversación cruza el límite sin
      // corte y el modelo NUNCA usa el fin de sesión como señal para colgar —
      // el fin de la llamada lo decide solo el contexto conversacional.
      if (data.goAway) {
        const timeLeft = data.goAway?.timeLeft
        console.warn('[gemini-live] goAway received — pre-fetch + proactive resume', data.goAway)
        logEvent('go_away', { timeLeft })
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

        // Programa la reconexión proactiva ~3s antes de que Gemini cierre.
        const secs = parseTimeLeftSeconds(timeLeft)
        const fireInMs = Math.max(secs - 3, 1) * 1000
        if (goAwayTimerRef.current) clearTimeout(goAwayTimerRef.current)
        goAwayTimerRef.current = setTimeout(() => {
          goAwayTimerRef.current = null
          // Abortamos si: el usuario ya colgó; hay un fin de llamada legítimo en
          // curso; no hay handle; ya reconectamos por otra vía; o el modelo está
          // hablando ahora mismo (en ese caso dejamos que el cierre natural +
          // reconexión lo maneje, para no cortar audio a media frase).
          if (isUserDisconnectingRef.current) return
          if (pendingHangupRef.current) return
          if (!sessionHandleRef.current) return
          if (wsRef.current !== ws) return
          if (activeSourcesRef.current.length > 0) return
          console.log('[gemini-live] goAway: proactive resume firing')
          logEvent('proactive_resume')
          setIsReconnecting(true) // cruce del límite de ~10 min en curso
          // Neutralizamos el socket viejo para que su onclose NO dispare otra
          // reconexión (evita sockets duplicados).
          ws.onclose = null
          ws.onmessage = null
          ws.onerror = null
          try { ws.close() } catch {}
          reconnectAttemptsRef.current = 0
          doReconnectRef.current()
        }, fireInMs)
      }

      // Function calling: el modelo pidió ejecutar una herramienta.
      // Por ahora solo soportamos `end_call`. Respondemos con un ack y
      // programamos el hangup para cuando termine de hablar.
      if (data.toolCall?.functionCalls) {
        const functionResponses: Array<{ id?: string; name: string; response: Record<string, unknown> }> = []
        let reengageAfterBlock = false
        let reengageMsg = REENGAGE_PROMPT
        for (const fc of data.toolCall.functionCalls) {
          if (fc.name === 'end_call') {
            const args = fc.args || {}
            const reason = (args.reason as CallEndReason) || 'timeout'
            const summary = typeof args.summary === 'string' ? args.summary : undefined

            // Gating determinista (engine/call-lifecycle) en DOS frentes. Si se
            // rechaza, NO colgamos: devolvemos un toolResponse que reconduce al
            // modelo a seguir en personaje, así no queda dead-air tras una
            // despedida que ignoramos.
            const callAgeMs = connectedAtRef.current ? Date.now() - connectedAtRef.current : Infinity

            // (1) Piso mínimo por tipo — rechaza cortes absurdamente tempranos.
            if (!canModelEndCall(callAgeMs, roleplayType)) {
              console.warn('[gemini-live] end_call BLOQUEADO (demasiado temprano) — re-enganchando', { reason, type: roleplayType, callAgeS: Math.round(callAgeMs / 1000) })
              logEvent('end_call_blocked', { reason, ageS: Math.round(callAgeMs / 1000), cause: 'too_early' })
              functionResponses.push({
                id: fc.id,
                name: 'end_call',
                response: { ok: false, continue: true, message: STEER_CONTINUE_MSG },
              })
              reengageAfterBlock = true
              continue
            }

            // (2) Política de reason por tipo — en arco completo el modelo NO
            // puede autocerrar como 'cierre_exitoso' (el cierre lo declara el
            // usuario colgando). Evita que la IA dé la venta por cerrada sobre un
            // "sí" y cuelgue a mitad del pitch.
            if (!canModelUseReason(reason, roleplayType)) {
              // En arco completo el modelo NUNCA cuelga (lo termina el vendedor o el
              // cap duro). Reconducimos según el motivo que intentó:
              //  - cierre_exitoso MADURO (tras el pitch): avisamos "venta cerrada" al
              //    alumno y guiamos al modelo a confirmar y quedarse quieto.
              //  - cierre_exitoso temprano (soft-yes): lo empujamos a exigir el pitch.
              //  - cualquier otro (timeout/sin_interes/…): silencio o pausa mal leídos
              //    como "se acabó" → lo mantenemos en personaje (arreglo del corte
              //    prematuro reportado por Ana y otros).
              const isClose = reason === 'cierre_exitoso'
              const matureClose = isClose && isMatureClose(callAgeMs, roleplayType)
              console.warn('[gemini-live] end_call BLOQUEADO (el modelo no cuelga en arco completo) — re-enganchando', { reason, type: roleplayType, matureClose })
              logEvent('end_call_blocked', { reason, ageS: Math.round(callAgeMs / 1000), cause: matureClose ? 'close_mature' : isClose ? 'close_early' : 'model_no_hangup' })
              const steerMsg = matureClose ? STEER_CLOSE_DONE_MSG : isClose ? STEER_CLOSE_MSG : STEER_CONTINUE_MSG
              functionResponses.push({
                id: fc.id,
                name: 'end_call',
                response: { ok: false, continue: true, message: steerMsg },
              })
              reengageAfterBlock = true
              reengageMsg = matureClose ? REENGAGE_CLOSE_DONE_PROMPT : isClose ? REENGAGE_CLOSE_PROMPT : REENGAGE_PROMPT
              if (matureClose && !saleClosedFiredRef.current) {
                saleClosedFiredRef.current = true
                logEvent('sale_closed', { ageS: Math.round(callAgeMs / 1000) })
                onSaleClosedRef.current?.()
              }
              continue
            }

            console.log('[gemini-live] end_call received', { reason, summary })
            logEvent('end_call', { reason, ageS: Math.round(callAgeMs / 1000) })
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
        // Tras bloquear un end_call, inyectamos un turno de cliente para forzar
        // que el modelo vuelva a hablar (si solo respondemos a la función, a veces
        // se queda mudo esperando colgar → la llamada quedaba en silencio).
        if (reengageAfterBlock && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            clientContent: {
              turns: [{ role: 'user', parts: [{ text: reengageMsg }] }],
              turnComplete: true,
            },
          }))
        }
      }

      if (data.serverContent) {
        const sc = data.serverContent

        // Interrupción por barge-in: el usuario habló mientras el modelo hablaba.
        // Gemini para de enviar audio y manda este flag. Detenemos el playback
        // inmediatamente para que el usuario no escuche el audio ya buffereado
        // (puede quedar desincronizado con lo que el modelo va a decir ahora).
        if (sc.interrupted) {
          logEvent('interrupted')
          clearDeadAir() // el usuario barge-in: no hay dead-air
          stopPlayback()
          // Si había un end_call pendiente, su audio de despedida acaba de ser
          // interrumpido → los `onended` se anularon en stopPlayback y nadie
          // dispararía el hangup. Lo programamos aquí para no quedar mudos
          // (variante del bug "la IA se queda callada").
          if (pendingHangupRef.current) {
            setTimeout(() => {
              if (pendingHangupRef.current) {
                const info = pendingHangupRef.current
                pendingHangupRef.current = null
                onModelHangupRef.current?.(info)
              }
            }, 800)
          }
          return
        }

        const { modelTurn, turnComplete } = sc

        if (modelTurn?.parts) {
          for (const part of modelTurn.parts) {
            if (part.inlineData?.mimeType?.startsWith('audio/')) {
              clearDeadAir() // el modelo respondió: no hay dead-air
              if (!isModelSpeaking) {
                setIsModelSpeaking(true)
                onModelSpeaking?.(true)
              }
              playAudioChunk(part.inlineData.data)
            }
            if (part.text) {
              clearDeadAir() // el modelo ya está respondiendo (texto), aunque el audio tarde
              currentModelTextRef.current += part.text
            }
          }
        }

        const inputTr = sc.inputTranscription
        if (inputTr?.text) {
          currentUserTextRef.current += inputTr.text
          clearDeadAir() // el usuario está hablando
        }
        if (inputTr?.finished && currentUserTextRef.current) {
          const entry: TranscriptEntry = { role: 'user', text: currentUserTextRef.current.trim() }
          setTranscript((prev) => [...prev, entry])
          onTranscript?.(entry)
          currentUserTextRef.current = ''
          // El vendedor terminó su turno; el prospecto debería responder. Armamos
          // el watchdog: si se queda mudo > DEAD_AIR_MS, lo empujamos a retomar.
          armDeadAir()
        }

        const outputTr = sc.outputTranscription
        if (outputTr?.text) {
          clearDeadAir() // el modelo ya está respondiendo (transcripción de salida)
          currentModelTextRef.current += outputTr.text
        }

        if (turnComplete) {
          const hadUserText = !!currentUserTextRef.current
          const hadModelText = !!currentModelTextRef.current
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
          // Fallback: si el turno del usuario se cerró aquí (sin que llegara
          // inputTranscription.finished) y el modelo NO respondió en el mismo
          // turno, armamos el watchdog igualmente (no dependemos solo de 'finished').
          if (hadUserText && !hadModelText) armDeadAir()
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
      logEvent('ws_close', { code: ev.code, wasClean: ev.wasClean, reason: ev.reason || undefined })
      setIsConnected(false)
      clearDeadAir() // no dejar un empujón pendiente cruzar a otra conexión

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
        logEvent('reconnect_attempt', { n: reconnectAttemptsRef.current })
        setIsReconnecting(true) // caída recuperable: estamos reconectando
        // Siempre pedimos un token fresco — el token anterior puede haber expirado
        // (el OIDC token de Vercel tiene ~2 min de vida, lo que limita el access token de GCP).
        setTimeout(() => {
          if (!isUserDisconnectingRef.current) {
            doReconnectRef.current()
          }
        }, delayMs)
      } else {
        // Sin handle o agotados los intentos → ofrecer reanudar (si hay handle).
        giveUp()
      }
    }

    wsRef.current = ws
  }, [voiceName, systemPrompt, roleplayType, onTranscript, onModelSpeaking, playAudioChunk, stopPlayback, isModelSpeaking, logEvent, giveUp, armDeadAir, clearDeadAir])

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
        logEvent('reconnect_failed', { err: String(err) })
        giveUp()
      })
  }, [openSocket, giveUp, logEvent])
  doReconnectRef.current = doReconnect

  const connect = useCallback(async () => {
    try {
      // Reset state para una nueva sesión
      isUserDisconnectingRef.current = false
      sessionHandleRef.current = null
      reconnectAttemptsRef.current = 0
      pendingHangupRef.current = null
      connectedAtRef.current = null
      saleClosedFiredRef.current = false
      eventsRef.current = []
      setIsReconnecting(false)
      if (goAwayTimerRef.current) { clearTimeout(goAwayTimerRef.current); goAwayTimerRef.current = null }
      clearDeadAir()
      logEvent('connect')

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

      // ── Recuperación mobile: visibilitychange ──────────────────────────────
      // En iOS/Android, al bloquear pantalla o ir a background:
      //   1. El AudioContext se suspende automáticamente.
      //   2. El WebSocket se corta después de ~30s.
      // Cuando el usuario vuelve: resumimos el contexto y reconectamos el WS.
      if (typeof document !== 'undefined') {
        // Retirar listener anterior si existía (por si connect() se llamó dos veces)
        if (visibilityListenerRef.current) {
          document.removeEventListener('visibilitychange', visibilityListenerRef.current)
        }

        const handleVisibilityChange = () => {
          if (document.visibilityState !== 'visible') return
          if (isUserDisconnectingRef.current) return

          // 1. Reanudar AudioContext suspendido
          if (audioContextRef.current?.state === 'suspended') {
            audioContextRef.current.resume().catch((e) =>
              console.warn('[gemini-live] ctx resume on visibilitychange failed', e)
            )
          }

          // 2. Reconectar si el WebSocket murió mientras estábamos en background
          const wsState = wsRef.current?.readyState
          if (wsState !== WebSocket.OPEN && wsState !== WebSocket.CONNECTING) {
            console.log('[gemini-live] visibilitychange → ws dead, triggering reconnect')
            reconnectAttemptsRef.current = 0 // resetear para tener 3 intentos frescos
            doReconnectRef.current()
          }
        }

        visibilityListenerRef.current = handleVisibilityChange
        document.addEventListener('visibilitychange', handleVisibilityChange)
      }
    } catch (err) {
      logEvent('connect_error', { msg: err instanceof Error ? err.message : String(err) })
      onError?.(err instanceof Error ? err.message : 'Error conectando con Gemini')
    }
  }, [openSocket, onError, logEvent, clearDeadAir])

  const disconnect = useCallback(() => {
    isUserDisconnectingRef.current = true
    sessionHandleRef.current = null
    reconnectAttemptsRef.current = 0
    wsUrlRef.current = null
    pendingHangupRef.current = null
    setIsReconnecting(false)
    if (goAwayTimerRef.current) { clearTimeout(goAwayTimerRef.current); goAwayTimerRef.current = null }
    clearDeadAir()

    // Retirar el listener de visibilitychange para no intentar reconectar
    // después de que el usuario haya colgado intencionalmente.
    if (visibilityListenerRef.current && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', visibilityListenerRef.current)
      visibilityListenerRef.current = null
    }

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
  }, [stopPlayback, clearDeadAir])

  // Reanuda una llamada caída: la reconexión automática se agotó PERO hay
  // sessionHandle, así que reabrimos el socket preservando el contexto de la
  // conversación (Gemini retoma desde donde se cortó). No reinicia el transcript
  // ni el reloj de duración (eso vive en phone-ui).
  const resume = useCallback(() => {
    if (!sessionHandleRef.current) return
    logEvent('resume_requested')
    isUserDisconnectingRef.current = false
    reconnectAttemptsRef.current = 0
    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {})
    }
    doReconnectRef.current()
  }, [logEvent])

  const getEvents = useCallback(() => eventsRef.current, [])

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

  return { isConnected, isModelSpeaking, isReconnecting, transcript, connect, disconnect, resume, sendAudio, getEvents }
}
