'use client'

import { useState, useEffect } from 'react'

const STORAGE_KEY = 'sv_privacy_v1'

export function PrivacyBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) setVisible(true)
  }, [])

  const accept = () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 max-w-md w-full shadow-2xl">
        <h2 className="text-white font-semibold text-lg mb-3">Aviso de privacidad</h2>
        <ul className="text-zinc-400 text-sm space-y-2 mb-5 list-disc list-inside">
          <li>Tus llamadas de práctica se graban como texto (transcripción) para generar tu feedback.</li>
          <li>Las transcripciones se almacenan en nuestros servidores y no se comparten con terceros.</li>
          <li>Puedes solicitar la eliminación de tus datos en cualquier momento escribiendo a soporte.</li>
          <li>No grabamos audio — solo el texto de la conversación.</li>
        </ul>
        <div className="flex gap-3">
          <button
            onClick={accept}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors"
          >
            Entendido, acepto
          </button>
        </div>
      </div>
    </div>
  )
}
