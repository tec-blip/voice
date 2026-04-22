import Link from 'next/link'
import { LoginForm } from '@/components/auth/login-form'

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white tracking-tight">SalesVoice</h1>
          <p className="mt-2 text-zinc-400">Entrena tus habilidades de ventas con IA</p>
        </div>

        <div className="bg-zinc-900/50 backdrop-blur border border-zinc-800 rounded-xl p-8">
          <h2 className="text-xl font-semibold text-white mb-6">Iniciar sesión</h2>
          <LoginForm />
        </div>

        <p className="text-center text-sm text-zinc-400">
          ¿No tienes cuenta?{' '}
          <Link href="/register" className="text-blue-400 hover:text-blue-300 font-medium">
            Crear cuenta
          </Link>
        </p>
      </div>
    </div>
  )
}
