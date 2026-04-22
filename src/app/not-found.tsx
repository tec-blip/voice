import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <p className="text-6xl font-bold text-zinc-700">404</p>
        <div>
          <h2 className="text-xl font-bold text-white">Página no encontrada</h2>
          <p className="text-sm text-zinc-400 mt-2">La página que buscas no existe o fue movida.</p>
        </div>
        <Link
          href="/dashboard"
          className="inline-block px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
        >
          Ir al dashboard
        </Link>
      </div>
    </div>
  )
}
