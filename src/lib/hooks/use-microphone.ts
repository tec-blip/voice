import { useRef, useState, useCallback, useEffect } from 'react'

interface UseMicrophoneOptions {
  fftSize?: number
  onAudioData?: (data: Float32Array) => void
  onError?: (error: string) => void
}

interface UseMicrophoneReturn {
  isRecording: boolean
  frequencyData: Uint8Array | null
  start: () => Promise<MediaStream | null>
  stop: () => void
  getFrequencyData: () => Uint8Array | null
}

const TARGET_SAMPLE_RATE = 16000

// Cross-browser AudioContext (iOS Safari < 14 usa webkitAudioContext)
function getAudioContextClass(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null
  return window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext || null
}

// Downsampling lineal de Float32 a 16 kHz. Necesario porque iOS/Android suelen
// ignorar el sample rate solicitado en getUserMedia y capturar a 44.1k/48k.
// Promediamos las muestras del bloque origen para reducir aliasing antes de
// que Gemini reciba el PCM.
function downsampleBuffer(
  input: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number,
): Float32Array {
  if (outputSampleRate >= inputSampleRate) {
    return new Float32Array(input)
  }
  const ratio = inputSampleRate / outputSampleRate
  const outputLength = Math.floor(input.length / ratio)
  const result = new Float32Array(outputLength)
  let offsetResult = 0
  let offsetInput = 0
  while (offsetResult < outputLength) {
    const nextOffsetInput = Math.floor((offsetResult + 1) * ratio)
    let accum = 0
    let count = 0
    for (let i = offsetInput; i < nextOffsetInput && i < input.length; i++) {
      accum += input[i]
      count++
    }
    result[offsetResult] = count > 0 ? accum / count : 0
    offsetResult++
    offsetInput = nextOffsetInput
  }
  return result
}

export function useMicrophone(options: UseMicrophoneOptions = {}): UseMicrophoneReturn {
  const { fftSize = 256, onAudioData, onError } = options
  const [isRecording, setIsRecording] = useState(false)
  const [frequencyData, setFrequencyData] = useState<Uint8Array | null>(null)

  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const workletRef = useRef<AudioWorkletNode | null>(null)
  const animationRef = useRef<number | null>(null)

  // onAudioData en ref: los handlers de audio (worklet/ScriptProcessor) se
  // enganchan UNA sola vez en start(); si llamaran el `onAudioData` de ese
  // momento, quedarían con un closure congelado (el gate half-duplex/mute leía
  // isModelSpeaking/isMuted viejos → nunca funcionaba). Con el ref siempre
  // invocan la versión actual.
  const onAudioDataRef = useRef(onAudioData)
  onAudioDataRef.current = onAudioData

  const updateFrequencyData = useCallback(() => {
    if (!analyserRef.current) return
    const data = new Uint8Array(analyserRef.current.frequencyBinCount)
    analyserRef.current.getByteFrequencyData(data)
    setFrequencyData(data)
    animationRef.current = requestAnimationFrame(updateFrequencyData)
  }, [])

  const start = useCallback(async (): Promise<MediaStream | null> => {
    try {
      // Verificar soporte del navegador (algunos móviles antiguos / WebViews no lo tienen)
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        onError?.('Tu navegador no soporta acceso al micrófono. Usa Chrome o Safari moderno.')
        return null
      }

      const AudioContextClass = getAudioContextClass()
      if (!AudioContextClass) {
        onError?.('Tu navegador no soporta Web Audio API.')
        return null
      }

      // Guarda de reentrada: si una captura anterior quedó viva (p.ej. un error
      // que no la cerró), la desmontamos antes de crear otra. Dos pipelines
      // simultáneos enviando a Gemini corrompen el audio.
      if (streamRef.current || audioContextRef.current) {
        if (animationRef.current) { cancelAnimationFrame(animationRef.current); animationRef.current = null }
        if (workletRef.current) { workletRef.current.port.onmessage = null; try { workletRef.current.disconnect() } catch {} }
        try { processorRef.current?.disconnect() } catch {}
        try { sourceRef.current?.disconnect() } catch {}
        streamRef.current?.getTracks().forEach((t) => t.stop())
        try { audioContextRef.current?.close() } catch {}
        workletRef.current = null
        processorRef.current = null
        sourceRef.current = null
        analyserRef.current = null
        streamRef.current = null
        audioContextRef.current = null
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      })

      // Intentamos crear el contexto directamente a 16 kHz: en Chrome/Android/
      // desktop el navegador resamplea el mic con su resampler nativo (alta
      // calidad) y el worklet solo hace passthrough. iOS Safari ignora o rechaza
      // el sampleRate forzado → caemos al rate nativo y el worklet resamplea por
      // software (interpolación lineal). El worklet lee el rate real del contexto.
      let audioContext: AudioContext
      try {
        audioContext = new AudioContextClass({ sampleRate: TARGET_SAMPLE_RATE })
      } catch {
        audioContext = new AudioContextClass()
      }

      // iOS suspende el AudioContext hasta que hay un user gesture.
      // start() se llama desde el handler del botón "Llamar", así que
      // resume() debería funcionar. Si no, reportamos error para que el UI lo capture.
      if (audioContext.state === 'suspended') {
        try {
          await audioContext.resume()
        } catch (resumeErr) {
          console.warn('[mic] AudioContext.resume() falló', resumeErr)
        }
      }

      const inputSampleRate = audioContext.sampleRate
      console.log(`[mic] AudioContext sampleRate=${inputSampleRate}Hz (target=${TARGET_SAMPLE_RATE}Hz)`)

      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = fftSize
      analyser.smoothingTimeConstant = 0.8
      source.connect(analyser)

      if (onAudioData) {
        // Preferimos AudioWorklet (corre en el hilo de audio → no pierde frames
        // aunque el main thread esté ocupado con React). Fallback a ScriptProcessor
        // si el navegador no lo soporta o falla la carga del módulo.
        let useWorklet = false
        if (audioContext.audioWorklet) {
          try {
            await audioContext.audioWorklet.addModule('/mic-worklet.js')
            const worklet = new AudioWorkletNode(audioContext, 'mic-capture')
            worklet.port.onmessage = (e) => onAudioDataRef.current?.(e.data as Float32Array)
            source.connect(worklet)
            // Conectar a destination hace que el grafo "tire" del worklet; su
            // salida es silencio (no escribe outputs) → no produce eco.
            worklet.connect(audioContext.destination)
            workletRef.current = worklet
            useWorklet = true
            console.log('[mic] captura vía AudioWorklet')
          } catch (workletErr) {
            console.warn('[mic] AudioWorklet falló, fallback a ScriptProcessor', workletErr)
          }
        }

        if (!useWorklet) {
          // Fallback legacy (navegadores sin AudioWorklet). ScriptProcessor corre
          // en el main thread y puede perder frames; es la mejor opción disponible.
          const bufferSize = inputSampleRate >= 32000 ? 4096 : 2048
          const processor = audioContext.createScriptProcessor(bufferSize, 1, 1)
          source.connect(processor)
          processor.connect(audioContext.destination)
          processor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0)
            const resampled =
              inputSampleRate === TARGET_SAMPLE_RATE
                ? new Float32Array(inputData)
                : downsampleBuffer(inputData, inputSampleRate, TARGET_SAMPLE_RATE)
            onAudioDataRef.current?.(resampled)
          }
          processorRef.current = processor
        }
      }

      audioContextRef.current = audioContext
      analyserRef.current = analyser
      sourceRef.current = source
      streamRef.current = stream

      setIsRecording(true)
      animationRef.current = requestAnimationFrame(updateFrequencyData)

      return stream
    } catch (err) {
      // Mensajes específicos por tipo de error — los más comunes en móvil son
      // NotAllowedError (permiso denegado) y NotFoundError (sin micrófono).
      console.error('[mic] start() failed', err)
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          onError?.(
            'Permiso de micrófono denegado. Activa el micrófono en los ajustes del navegador y vuelve a intentarlo.',
          )
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          onError?.('No se encontró ningún micrófono en el dispositivo.')
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          onError?.('El micrófono está siendo usado por otra app. Ciérrala y vuelve a intentar.')
        } else if (err.name === 'OverconstrainedError') {
          onError?.('Tu micrófono no soporta la configuración requerida.')
        } else if (err.name === 'SecurityError') {
          onError?.('El acceso al micrófono requiere HTTPS.')
        } else {
          onError?.(`Error al iniciar el micrófono: ${err.message}`)
        }
      } else {
        onError?.('Error desconocido al iniciar el micrófono.')
      }
      return null
    }
  }, [fftSize, onAudioData, onError, updateFrequencyData])

  const stop = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }

    if (workletRef.current) {
      workletRef.current.port.onmessage = null
      workletRef.current.disconnect()
      workletRef.current = null
    }
    processorRef.current?.disconnect()
    sourceRef.current?.disconnect()
    analyserRef.current?.disconnect()

    streamRef.current?.getTracks().forEach((track) => track.stop())

    audioContextRef.current?.close()

    audioContextRef.current = null
    analyserRef.current = null
    sourceRef.current = null
    streamRef.current = null
    processorRef.current = null

    setIsRecording(false)
    setFrequencyData(null)
  }, [])

  const getFrequencyData = useCallback((): Uint8Array | null => {
    if (!analyserRef.current) return null
    const data = new Uint8Array(analyserRef.current.frequencyBinCount)
    analyserRef.current.getByteFrequencyData(data)
    return data
  }, [])

  // Cleanup al desmontar
  useEffect(() => {
    return () => { stop() }
  }, [stop])

  // ── Recuperación mobile: visibilitychange ────────────────────────────────
  // En iOS, al volver de background, el AudioContext del micro puede estar
  // suspendido. En algunos casos los tracks quedan en state='ended' (la pantalla
  // se bloqueó). Detectamos ambas situaciones y actuamos.
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    if (!isRecording) return

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return

      // Comprobar si los tracks del micrófono siguen vivos
      if (streamRef.current) {
        const tracks = streamRef.current.getTracks()
        const allEnded = tracks.length > 0 && tracks.every((t) => t.readyState === 'ended')
        if (allEnded) {
          console.warn('[mic] visibilitychange → tracks ended, mic interrumpido')
          stop()
          onErrorRef.current?.(
            'El micrófono fue interrumpido (pantalla bloqueada). Por favor reinicia la llamada.'
          )
          return
        }
      }

      // Reanudar AudioContext suspendido (iOS lo suspende al ir a background)
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume().catch((e) =>
          console.warn('[mic] resume on visibilitychange failed', e)
        )
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [isRecording, stop])

  return { isRecording, frequencyData, start, stop, getFrequencyData }
}
