'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const steps = [
  {
    title: 'Bienvenido a SalesVoice',
    description: 'Tu entrenador personal de ventas con inteligencia artificial. Practica roleplay de ventas con un prospecto IA que se adapta a tu nivel.',
    icon: '🎯',
  },
  {
    title: 'Elige tu escenario',
    description: 'Selecciona entre 5 tipos de práctica: cierre de ventas, llamada en frío, framing, manejo de objeciones o llamada general. Cada uno simula situaciones reales.',
    icon: '📋',
  },
  {
    title: 'Habla con el prospecto',
    description: 'Presiona el botón verde para iniciar la llamada. Habla naturalmente — el prospecto IA te responderá en tiempo real con voz. Practica como si fuera una llamada real.',
    icon: '📞',
  },
  {
    title: 'Recibe feedback detallado',
    description: 'Al terminar, recibirás una evaluación en 6 categorías con puntuación, feedback específico y el momento clave de la conversación. ¡Mejora con cada sesión!',
    icon: '📊',
  },
]

export default function OnboardingPage() {
  const [step, setStep] = useState(0)
  const router = useRouter()

  const isLast = step === steps.length - 1
  const current = steps[step]

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <div className="max-w-lg w-full space-y-8 text-center px-4">
        <div className="flex justify-center gap-2">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-8 bg-blue-500' : i < step ? 'w-8 bg-blue-500/40' : 'w-8 bg-zinc-700'
              }`}
            />
          ))}
        </div>

        <div className="space-y-4">
          <span className="text-5xl">{current.icon}</span>
          <h1 className="text-2xl font-bold text-white">{current.title}</h1>
          <p className="text-zinc-400 leading-relaxed max-w-md mx-auto">{current.description}</p>
        </div>

        <div className="flex justify-center gap-3">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="px-6 py-2.5 rounded-lg bg-zinc-800 text-zinc-300 text-sm font-medium hover:bg-zinc-700 transition-colors"
            >
              Atrás
            </button>
          )}
          <button
            onClick={() => {
              if (isLast) {
                router.push('/dashboard/practice')
              } else {
                setStep(step + 1)
              }
            }}
            className="px-8 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
          >
            {isLast ? '¡Empezar a practicar!' : 'Siguiente'}
          </button>
        </div>

        {!isLast && (
          <button
            onClick={() => router.push('/dashboard')}
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Saltar tutorial
          </button>
        )}
      </div>
    </div>
  )
}
