// AudioWorklet: captura el micrófono en el HILO DE AUDIO (no el main thread, así
// no se pierden frames cuando React renderiza) y lo entrega a 16 kHz mono.
//
// Reemplaza al ScriptProcessorNode (deprecado, corría en el main thread y perdía
// audio en llamadas largas → "no te escucho") y al downsample por promedio de
// bloque (filtraba/embarraba el espectro → transcripción basura / idiomas raros).
// Aquí: passthrough si el contexto ya está a 16 kHz, o resampling LINEAL continuo
// (preservando la fase entre bloques) si no.

const OUT_RATE = 16000
const FRAME = 1024 // muestras de salida por mensaje (~64 ms a 16 kHz)

class MicCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    // `sampleRate` es global en el AudioWorkletGlobalScope (rate del contexto).
    this._ratio = sampleRate / OUT_RATE
    this._buf = new Float32Array(FRAME)
    this._n = 0
    // Posición de lectura fraccional (en muestras de entrada). Arranca en 1 para
    // que la primera salida sea exactamente ch[0]. En bloques siguientes cae en
    // [0, ratio) y la muestra previa (_prev) cubre la interpolación del límite.
    this._pos = 1
    this._prev = 0
  }

  _emit(sample) {
    this._buf[this._n++] = sample
    if (this._n >= FRAME) {
      // slice() copia: seguro reutilizar el buffer interno tras postMessage.
      this.port.postMessage(this._buf.slice(0, FRAME))
      this._n = 0
    }
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const ch = input[0]
    if (!ch || ch.length === 0) return true
    const L = ch.length

    if (this._ratio === 1) {
      for (let i = 0; i < L; i++) this._emit(ch[i])
      return true
    }

    // Array virtual W = [_prev, ch[0], ch[1], ...]: W[0]=_prev, W[k]=ch[k-1].
    // Para posición p: s0=W[floor(p)], s1=W[floor(p)+1]=ch[floor(p)].
    let p = this._pos
    while (p < L) {
      const i0 = Math.floor(p)
      const frac = p - i0
      const s0 = i0 === 0 ? this._prev : ch[i0 - 1]
      const s1 = ch[i0]
      this._emit(s0 + (s1 - s0) * frac)
      p += this._ratio
    }
    this._pos = p - L // arrastra la fase al siguiente bloque
    this._prev = ch[L - 1]
    return true
  }
}

registerProcessor('mic-capture', MicCaptureProcessor)
