import { useRef, useState, useCallback } from 'react'

interface TranscriptEntry {
  role: 'user' | 'model'
  text: string
}

interface UseGeminiLiveOptions {
  systemPrompt: string
  voiceName?: string
  onTranscript?: (entry: TranscriptEntry) => void
  onModelSpeaking?: (speaking: boolean) => void
  onError?: (error: string) => void
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

export function useGeminiLive(options: UseGeminiLiveOptions): UseGeminiLiveReturn {
  const { systemPrompt, voiceName = 'Kore', onTranscript, onModelSpeaking, onError } = options

  const [isConnected, setIsConnected] = useState(false)
  const [isModelSpeaking, setIsModelSpeaking] = useState(false)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])

  const wsRef = useRef<WebSocket | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const nextPlayTimeRef = useRef(0)
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const currentModelTextRef = useRef('')
  const currentUserTextRef = useRef('')

  const playAudioChunk = useCallback((pcmBase64: string) => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new AudioContext({ sampleRate: 24000 })
    }

    const ctx = audioContextRef.current
    const pcmBuffer = base64Decode(pcmBase64)
    const int16Data = new Int16Array(pcmBuffer)
    const float32Data = int16ToFloat32(int16Data)

    const audioBuffer = ctx.createBuffer(1, float32Data.length, 24000)
    audioBuffer.getChannelData(0).set(float32Data)

    const source = ctx.createBufferSource()
    source.buffer = audioBuffer
    source.connect(ctx.destination)

    const startTime = Math.max(ctx.currentTime + 0.05, nextPlayTimeRef.current)
    source.start(startTime)
    nextPlayTimeRef.current = startTime + audioBuffer.duration

    activeSourcesRef.current.push(source)
    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source)
      if (activeSourcesRef.current.length === 0) {
        setIsModelSpeaking(false)
        onModelSpeaking?.(false)
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

  const connect = useCallback(async () => {
    try {
      // Critical: create + resume the playback AudioContext inside the user-gesture
      // chain (this connect() is called from a click handler). If we wait until
      // audio arrives from the WS to create it, Chrome/Brave create it suspended
      // and no audio plays.
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new AudioContext({ sampleRate: 24000 })
      }
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume()
      }
      console.log('[gemini-live] playback AudioContext state =', audioContextRef.current.state)

      const res = await fetch('/api/gemini/config')
      if (!res.ok) throw new Error('Failed to get Gemini config')
      const { wsUrl } = await res.json()

      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        console.log('[gemini-live] ws.onopen — sending setup')
        const setupMessage = {
          setup: {
            model: 'models/gemini-3.1-flash-live-preview',
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName,
                  },
                },
              },
            },
            systemInstruction: {
              parts: [{ text: systemPrompt }],
            },
            // Habilita transcripción automática del audio de entrada (usuario)
            // y de salida (modelo). Sin esto, el transcript queda vacío porque
            // responseModalities es sólo ['AUDIO'].
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        }
        ws.send(JSON.stringify(setupMessage))
      }

      ws.onmessage = async (event) => {
        // Gemini Live sends TEXT frames in some transports and BINARY (Blob) in others
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

        console.log('[gemini-live] message', Object.keys(data).join(','))

        if (data.setupComplete !== undefined) {
          console.log('[gemini-live] setupComplete — connected')
          setIsConnected(true)
          return
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

          // Transcripción del audio del USUARIO (inputAudioTranscription habilitada en setup)
          // La API envía chunks parciales; acumulamos y cerramos el turno al recibir un
          // marcador (o al llegar inputTranscription.finished). Como no todos los
          // servidores envían `finished`, también cerramos el turno cuando el modelo
          // empieza a hablar (detectado por modelTurn audio en este mismo mensaje).
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

          // Transcripción del audio del MODELO (outputAudioTranscription)
          const outputTr = sc.outputTranscription
          if (outputTr?.text) {
            currentModelTextRef.current += outputTr.text
          }

          if (turnComplete) {
            // Cierra el turno del usuario si aún tenía texto pendiente sin `finished`
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
        onError?.('Error en la conexión con Gemini')
      }

      ws.onclose = (ev) => {
        console.warn(`[gemini-live] ws.onclose code=${ev.code} wasClean=${ev.wasClean} reason="${ev.reason || '(empty)'}"`)
        setIsConnected(false)
        stopPlayback()
      }

      wsRef.current = ws
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Error conectando con Gemini')
    }
  }, [systemPrompt, voiceName, onTranscript, onModelSpeaking, onError, playAudioChunk, stopPlayback, isModelSpeaking])

  const disconnect = useCallback(() => {
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
