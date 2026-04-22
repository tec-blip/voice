import { useRef, useState, useCallback, useEffect } from 'react'

interface UseMicrophoneOptions {
  fftSize?: number
  onAudioData?: (data: Float32Array) => void
}

interface UseMicrophoneReturn {
  isRecording: boolean
  frequencyData: Uint8Array | null
  start: () => Promise<MediaStream | null>
  stop: () => void
  getFrequencyData: () => Uint8Array | null
}

export function useMicrophone(options: UseMicrophoneOptions = {}): UseMicrophoneReturn {
  const { fftSize = 256, onAudioData } = options
  const [isRecording, setIsRecording] = useState(false)
  const [frequencyData, setFrequencyData] = useState<Uint8Array | null>(null)

  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const animationRef = useRef<number | null>(null)

  const updateFrequencyData = useCallback(() => {
    if (!analyserRef.current) return
    const data = new Uint8Array(analyserRef.current.frequencyBinCount)
    analyserRef.current.getByteFrequencyData(data)
    setFrequencyData(data)
    animationRef.current = requestAnimationFrame(updateFrequencyData)
  }, [])

  const start = useCallback(async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      })

      const audioContext = new AudioContext({ sampleRate: 16000 })
      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = fftSize
      analyser.smoothingTimeConstant = 0.8

      source.connect(analyser)

      if (onAudioData) {
        const processor = audioContext.createScriptProcessor(4096, 1, 1)
        analyser.connect(processor)
        processor.connect(audioContext.destination)
        processor.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0)
          onAudioData(new Float32Array(inputData))
        }
        processorRef.current = processor
      }

      audioContextRef.current = audioContext
      analyserRef.current = analyser
      sourceRef.current = source
      streamRef.current = stream

      setIsRecording(true)
      animationRef.current = requestAnimationFrame(updateFrequencyData)

      return stream
    } catch {
      return null
    }
  }, [fftSize, onAudioData, updateFrequencyData])

  const stop = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
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

  useEffect(() => {
    return () => {
      stop()
    }
  }, [stop])

  return { isRecording, frequencyData, start, stop, getFrequencyData }
}
