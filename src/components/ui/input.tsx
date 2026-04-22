'use client'

import { InputHTMLAttributes, forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', id, ...props }, ref) => (
    <div>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-zinc-300 mb-1.5">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={id}
        className={`w-full rounded-lg bg-zinc-900 border px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 transition-colors ${
          error
            ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
            : 'border-zinc-700 focus:ring-blue-500 focus:border-blue-500'
        } ${className}`}
        {...props}
      />
      {error && <p className="mt-1.5 text-sm text-red-400">{error}</p>}
    </div>
  )
)
Input.displayName = 'Input'
