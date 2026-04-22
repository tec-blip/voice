import { NextResponse } from 'next/server'
import { EVALUATION_PROMPT, type EvaluationResult } from '@/lib/prompts/evaluation'

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Gemini API key not configured' }, { status: 500 })
  }

  try {
    const { transcript } = await request.json()

    if (!transcript || typeof transcript !== 'string') {
      return NextResponse.json({ error: 'Invalid transcript' }, { status: 400 })
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `${EVALUATION_PROMPT}\n\n---\n\nTRANSCRIPCIÓN DE LA LLAMADA:\n\n${transcript}`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            responseMimeType: 'application/json',
          },
        }),
      }
    )

    if (!res.ok) {
      const errorText = await res.text()
      return NextResponse.json({ error: `Gemini API error: ${errorText}` }, { status: res.status })
    }

    const data = await res.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text

    if (!text) {
      return NextResponse.json({ error: 'Empty response from Gemini' }, { status: 500 })
    }

    const evaluation: EvaluationResult = JSON.parse(text)

    const categories: (keyof EvaluationResult)[] = [
      'apertura', 'descubrimiento', 'presentacion', 'objeciones', 'cierre', 'tono',
    ]
    for (const cat of categories) {
      const val = evaluation[cat]
      if (typeof val !== 'number' || val < 0 || val > 100) {
        (evaluation as unknown as Record<string, unknown>)[cat] = 50
      }
    }

    return NextResponse.json(evaluation)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Evaluation error' },
      { status: 500 }
    )
  }
}
