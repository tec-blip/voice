// Regenera src/data/scenarios.json a partir de scripts/data/profiles.jsonl.
//
// Los perfiles ya vienen extraídos por extract-call-profiles.py (1 por llamada
// real). Este paso es pura transformación de datos (SIN LLM): filtra los perfiles
// usables y los mapea al "scenario brief" que consume el agente.
//
// Reemplaza al build_scenario_briefs de aggregate-roleplay-assets.py, que capaba
// arbitrariamente a 30 escenarios (máx 4 por arquetipo). Aquí NO hay cap: se
// incluyen TODOS los perfiles con sustancia (dolor + ≥1 objeción + ≥1 frase).
//
// Añade `estado_inicial.nombre`: un nombre de pila FICTICIO y determinista (por
// género), para que el prospecto tenga identidad propia del caso y no tome la del
// vendedor ("Luis Romero"). NO se usa el nombre real del cliente (PII).
//
// Uso: node scripts/build-scenarios.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const IN = join(__dirname, 'data', 'profiles.jsonl')
const OUT_APP = join(__dirname, '..', 'src', 'data', 'scenarios.json')
const OUT_BRIEFS = join(__dirname, 'data', 'scenario_briefs.json')

const MIN_WORDS = 250

// Nombres de pila comunes (LATAM/España). Evito "Luis" para no ecoar a Luis Romero.
const MALE = ['Javier','Carlos','Miguel','Andrés','Sergio','Roberto','Alejandro','Diego','Camilo','Óscar','Manuel','Juan','Rubén','Daniel','Adrián','Francisco','Fernando','Jorge','Ricardo','Pablo','Iván','Héctor','Raúl','Gabriel','Mateo','Antonio','Emilio','Marco','Alberto','Cristian','Eduardo','Nicolás','Santiago','Tomás','Gonzalo','Rodrigo','Esteban','Felipe','Julián','Ramón']
const FEMALE = ['Marisol','Yolanda','Gabriela','Rosa','Verónica','Patricia','Marta','Cristina','Elena','Laura','Andrea','Carolina','Daniela','Valentina','Paola','Natalia','Sofía','Lucía','Mónica','Adriana','Alejandra','Fernanda','Claudia','Beatriz','Carmen','Isabel','Julia','Raquel','Sara','Diana','Camila','Mariana','Ximena','Pilar','Teresa','Silvia','Angélica','Lorena','Karla','Gloria']

function hashStr(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0 }
  return h
}

// Espejo de getVoiceByGender: m/f explícito; cualquier otra cosa → femenino
// (la voz por defecto es femenina, así el nombre concuerda con la voz).
function pickName(genero, id) {
  const g = (genero || '').toLowerCase().trim()
  const isMale = g === 'm' || g === 'hombre' || g === 'male'
  const pool = isMale ? MALE : FEMALE
  return pool[hashStr(id) % pool.length]
}

const lines = readFileSync(IN, 'utf8').split(/\r?\n/).filter(Boolean)
const briefs = []
let skipped = 0

for (const line of lines) {
  let p
  try { p = JSON.parse(line) } catch { skipped++; continue }
  const prf = p.perfil || {}
  const d = prf.demografia || {}
  const ps = prf.psicografia || {}
  const n = prf.narrativa || {}
  const c = prf.comercial || {}
  const objeciones = prf.objeciones || []
  const frases = prf.frases_cliente || []

  // Filtro de calidad: caso con sustancia real.
  const usable = n.dolor_principal && objeciones.length >= 1 && frases.length >= 1 && (p.word_count || 0) >= MIN_WORDS
  if (!usable) { skipped++; continue }

  briefs.push({
    scenario_id: `sc_${p.id}`,
    arquetipo_label: prf.arquetipo,
    nicho: p.nicho,
    dificultad_1_5: prf.dificultad_roleplay_1_5,
    resistencia_1_5: ps.resistencia_al_cierre_1_5,
    estado_inicial: {
      nombre: pickName(d.genero, p.id),
      genero: d.genero,
      pais: d.pais,
      ocupacion: d.ocupacion,
      situacion_familiar: d.situacion_familiar,
      tono_inicial: ps.tono_inicial,
      nivel_experiencia: ps.nivel_experiencia,
      estilo_decision: ps.estilo_decision,
      relacion_con_dinero: ps.relacion_con_dinero,
      estilo_habla: ps.estilo_habla,
      muletillas: ps.muletillas || [],
      regionalismos: ps.regionalismos || [],
      presupuesto_inicial: c.presupuesto_inicial,
      motivacion: n.motivacion_principal,
      dolor: n.dolor_principal,
      que_lo_trajo: n.que_lo_trajo_a_la_llamada,
      experiencia_previa: n.experiencia_previa_relacionada,
    },
    objeciones_a_plantear: objeciones.map((o) => ({
      texto: o.objecion, tipo: o.tipo, profundidad: o.profundidad, orden: o.orden,
    })),
    preguntas_a_hacer: prf.preguntas_tipicas_del_cliente || [],
    frases_de_estilo: frases,
    valor_para_entrenamiento: prf.valor_para_entrenamiento,
    source_call_id: p.id,
  })
}

const byNicho = {}
for (const b of briefs) byNicho[b.nicho] = (byNicho[b.nicho] || 0) + 1

writeFileSync(OUT_APP, JSON.stringify(briefs, null, 2) + '\n')
writeFileSync(OUT_BRIEFS, JSON.stringify(briefs, null, 2) + '\n')

console.log(`Perfiles leídos: ${lines.length}`)
console.log(`Escenarios generados: ${briefs.length}  (descartados: ${skipped})`)
console.log('Por nicho:', byNicho)
console.log(`Escrito: ${OUT_APP}`)
