interface CardProps {
  children: React.ReactNode
  className?: string
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <div className={`bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 ${className}`}>
      {children}
    </div>
  )
}

export function CardTitle({ children, className = '' }: CardProps) {
  return <h3 className={`text-lg font-semibold text-white ${className}`}>{children}</h3>
}

export function CardDescription({ children, className = '' }: CardProps) {
  return <p className={`text-sm text-zinc-400 mt-1 ${className}`}>{children}</p>
}
