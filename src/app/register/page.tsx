import Link from 'next/link'
import { RegisterForm } from '@/components/auth/register-form'

export default function RegisterPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white tracking-tight">SalesVoice</h1>
          <p className="mt-2 text-zinc-400">Entrena tus habilidades de ventas con IA</p>
        </div>

        <div className="bg-zinc-900/50 backdrop-blur border border-zinc-800 rounded-xl p-8">
          <h2 className="text-xl font-semibold text-white mb-6">Crear cuenta</h2>
          <RegisterForm />
        </div>

        <p className="text-center text-sm text-zinc-400">
          ¿Ya tienes cuenta?{' '}
          <Link href="/login" className="text-blue-400 hover:text-blue-300 font-medium">
            Iniciar sesión
          </Link>
        </p>
      </div>
    </div>
  )
}
