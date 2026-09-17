import { NextRequest, NextResponse } from 'next/server'
import scenariosData from '@/data/scenarios.json'
import { createClient } from '@/lib/supabase/server'

export interface ScenarioBrief {
  scenario_id: string
  arquetipo_label: string
  nicho: string
  dificultad_1_5: number
  resistencia_1_5: number
  estado_inicial: {
    nombre?: string
    genero?: string
    pais?: string
    ocupacion?: string
    situacion_familiar?: string
    tono_inicial?: string
    nivel_experiencia?: string
    estilo_decision?: string
    relacion_con_dinero?: string
    estilo_habla?: string
    muletillas?: string[]
    regionalismos?: string[]
    presupuesto_inicial?: string
    motivacion?: string
    dolor?: string
    que_lo_trajo?: string
    experiencia_previa?: string
  }
  objeciones_a_plantear: Array<{
    texto?: string
    tipo?: string
    profundidad?: string
    orden?: number
  }>
  preguntas_a_hacer: string[]
  frases_de_estilo: string[]
  valor_para_entrenamiento?: string
  source_call_id: string
}

const ALL_NICHOS = ['trading', 'marca_personal_instagram']
const scenarios = scenariosData as unknown as ScenarioBrief[]

// Los datos reales están sesgados a hombres (~75% M / ~23% F), así que las
// clientas —y por tanto las voces femeninas— salían poco en la práctica. Elevamos
// su probabilidad a este objetivo. OJO: seguimos eligiendo un escenario REAL de
// mujer (no forzamos voz femenina sobre un caso de hombre), así cliente, voz y
// caso quedan coherentes. Ajustable.
const FEMALE_TARGET_SHARE = 0.4

function isFemale(s: ScenarioBrief): boolean {
  return (s.estado_inicial?.genero ?? '').trim().toUpperCase() === 'F'
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function getScenario(nicho?: string): ScenarioBrief | null {
  let pool = scenarios
  if (nicho && nicho !== 'aleatorio' && ALL_NICHOS.includes(nicho)) {
    pool = scenarios.filter(s => s.nicho === nicho)
  }
  if (!pool.length) pool = scenarios
  if (!pool.length) return null

  // Selección ponderada por género: sube la aparición de clientas al objetivo.
  const female = pool.filter(isFemale)
  const rest = pool.filter(s => !isFemale(s))
  if (female.length && rest.length) {
    return Math.random() < FEMALE_TARGET_SHARE ? pickRandom(female) : pickRandom(rest)
  }
  // Si el pool no tiene ambos géneros, aleatorio simple.
  return pickRandom(pool)
}

// GET /api/scenarios?nicho=trading|marca_personal_instagram|aleatorio
export async function GET(req: NextRequest) {
  // Requiere usuario autenticado — evita que scripts externos consuman el endpoint
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const nicho = req.nextUrl.searchParams.get('nicho') ?? 'aleatorio'
  const scenario = getScenario(nicho)
  if (!scenario) {
    return NextResponse.json({ error: 'No scenarios found' }, { status: 404 })
  }
  return NextResponse.json(scenario)
}
