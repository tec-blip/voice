import { SalesVoiceLogo } from '@/components/ui/sales-voice-logo'
import { ResetPasswordForm } from '@/components/auth/reset-password-form'

export default function ResetPasswordPage() {
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
          <h2 className="text-xl font-semibold text-white mb-2">Nueva contraseña</h2>
          <p className="text-sm text-zinc-400 mb-6">
            Elige una nueva contraseña para tu cuenta.
          </p>
          <ResetPasswordForm />
        </div>
      </div>
    </div>
  )
}
