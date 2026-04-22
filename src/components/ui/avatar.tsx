'use client'

type AvatarSize = 'sm' | 'md' | 'lg'

interface AvatarProps {
  name?: string
  src?: string | null
  size?: AvatarSize
}

const sizeClasses: Record<AvatarSize, string> = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function Avatar({ name, src, size = 'md' }: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={name || ''}
        className={`${sizeClasses[size]} rounded-full object-cover`}
      />
    )
  }

  return (
    <div
      className={`${sizeClasses[size]} rounded-full bg-zinc-700 flex items-center justify-center font-medium text-zinc-300`}
    >
      {name ? getInitials(name) : '?'}
    </div>
  )
}
