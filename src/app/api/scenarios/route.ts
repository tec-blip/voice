import { NextRequest, NextResponse } from 'next/server'
import scenariosData from '@/data/scenarios.json'

export interface ScenarioBrief {
  scenario_id: string
  arquetipo_label: string
  nicho: string
  dificultad_1_5: number
  resistencia_1_5: number
  estado_inicial: {
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

function getScenario(nicho?: string): ScenarioBrief | null {
  let pool = scenarios
  if (nicho && nicho !== 'aleatorio' && ALL_NICHOS.includes(nicho)) {
    pool = scenarios.filter(s => s.nicho === nicho)
  }
  if (!pool.length) pool = scenarios
  return pool[Math.floor(Math.random() * pool.length)]
}

// GET /api/scenarios?nicho=trading|marca_personal_instagram|aleatorio
export async function GET(req: NextRequest) {
  const nicho = req.nextUrl.searchParams.get('nicho') ?? 'aleatorio'
  const scenario = getScenario(nicho)
  if (!scenario) {
    return NextResponse.json({ error: 'No scenarios found' }, { status: 404 })
  }
  return NextResponse.json(scenario)
}
