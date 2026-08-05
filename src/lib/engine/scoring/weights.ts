// Pesos y constantes de scoring de la Metodología Luis Romero.
//
// Antes vivían como TEXTO dentro del prompt de evaluación (evaluation.ts), donde
// se le pedía al LLM calcular el promedio ponderado. Ahora son la única fuente de
// verdad en código: el promedio lo calcula `computeOverallScore`, no el modelo.

export const CATEGORY_KEYS = [
  'apertura',
  'descubrimiento',
  'presentacion',
  'objeciones',
  'cierre',
  'tono',
] as const

export type CategoryKey = (typeof CATEGORY_KEYS)[number]

/** Mapa de categoría → score 0-100. */
export type CategoryScores = Record<CategoryKey, number>

/**
 * Pesos del promedio ponderado. descubrimiento y cierre pesan el doble;
 * objeciones x1.5; el resto x1. Suma = WEIGHT_DENOMINATOR.
 */
export const CATEGORY_WEIGHTS: Record<CategoryKey, number> = {
  apertura: 1,
  descubrimiento: 2,
  presentacion: 1,
  objeciones: 1.5,
  cierre: 2,
  tono: 1,
}

/** Suma de todos los pesos (1 + 2 + 1 + 1.5 + 2 + 1 = 8.5). */
export const WEIGHT_DENOMINATOR = Object.values(CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0)

/** Valor por defecto cuando una categoría llega inválida o ausente. */
export const DEFAULT_CATEGORY_SCORE = 50

/**
 * Categorías que NO se pueden ejecutar en ciertos modos (drills donde esa fase
 * ya ocurrió o no forma parte del ejercicio). Se muestran como "No aplica" en la
 * UI y se EXCLUYEN del promedio general — así no penalizan al alumno por algo que
 * el formato no le permite hacer. Reportado por testers (objeciones arranca ya en
 * la objeción: no hay apertura, ni descubrimiento, ni presentación).
 */
export const NA_CATEGORIES_BY_TYPE: Record<string, readonly CategoryKey[]> = {
  objeciones: ['apertura', 'descubrimiento', 'presentacion'],
}
