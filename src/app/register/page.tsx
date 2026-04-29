import Link from 'next/link'
import { RegisterForm } from '@/components/auth/register-form'
import { SalesVoiceLogo } from '@/components/ui/sales-voice-logo'

export default function RegisterPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center flex flex-col items-center gap-4">
          <SalesVoiceLogo size={72} animated />
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Sales Voice</h1>
            <p className="mt-1 text-zinc-400 text-sm">Entrena tus habilidades de ventas con IA</p>
          </div>
        </div>

        <div className="bg-zinc-900/50 backdrop-blur border border-zinc-800 rounded-xl p-8">
          <h2 className="text-xl font-semibold text-white mb-6">Crear cuenta</h2>
          <RegisterForm />
        </div>

        <p className="text-center text-sm text-zinc-400">
          ¿Ya tienes cuenta?{' '}
          <Link href="/login" className="text-red-400 hover:text-red-300 font-medium">
            Iniciar sesión
          </Link>
        </p>
      </div>
    </div>
  )
}
