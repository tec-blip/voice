export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-700 border-t-red-500" />
        <p className="text-sm text-zinc-500">Cargando...</p>
      </div>
    </div>
  )
}
