// Quick diagnostic: try several Live model names and report which one accepts the setup message.
import fs from 'node:fs'

const envFile = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const apiKey = envFile.match(/GEMINI_API_KEY=(.+)/)[1].trim()

const BASE_WS = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`
const BASE_WS_ALPHA = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`

const MODEL = 'models/gemini-3.1-flash-live-preview'
const speechConfig = {
  voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
}
const systemInstruction = { parts: [{ text: 'Eres un prospecto en español' }] }

const candidates = [
  // Exact app setup — does it stay open?
  { url: BASE_WS, model: MODEL, setup: { generationConfig: { responseModalities: ['AUDIO'], speechConfig }, systemInstruction } },
]

function test({ url, model, setup }) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url)
    const start = Date.now()
    let settled = false
    const finish = (status, detail) => {
      if (settled) return
      settled = true
      try { ws.close() } catch {}
      resolve({ model, url: url.startsWith(BASE_WS_ALPHA) ? 'v1alpha' : 'v1beta', status, detail, ms: Date.now() - start })
    }
    ws.onopen = () => {
      ws.send(JSON.stringify({ setup: { model, ...setup } }))
    }
    let gotSetup = false
    ws.onmessage = async (ev) => {
      try {
        const raw = typeof ev.data === 'string' ? ev.data : await ev.data.text()
        const data = JSON.parse(raw)
        if (data.setupComplete !== undefined && !gotSetup) {
          gotSetup = true
          console.log(`  → setupComplete for ${model} — holding 6s to see if server closes idle`)
          return
        }
        console.log(`  → msg: ${JSON.stringify(data).slice(0, 150)}`)
      } catch (e) {
        finish('MSG_PARSE_ERR', String(e))
      }
    }
    ws.onerror = (ev) => finish('ERROR', ev?.message || 'ws error')
    ws.onclose = (ev) => finish(gotSetup ? 'CLOSED_AFTER_SETUP' : 'CLOSED_BEFORE_SETUP', `code=${ev.code} reason="${ev.reason || '(none)'}"`)
    setTimeout(() => finish(gotSetup ? 'STILL_OPEN' : 'NO_SETUP', '8s'), 8000)
  })
}

for (const c of candidates) {
  const r = await test(c)
  console.log(`${r.status.padEnd(8)} | ${r.url.padEnd(8)} | ${r.model.padEnd(60)} | ${r.ms}ms | ${r.detail}`)
}
