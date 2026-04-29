'use client'

import { useEffect, useRef } from 'react'

interface AudioVisualizerProps {
  frequencyData: Uint8Array | null
  isActive: boolean
  barCount?: number
  color?: string
}

export function AudioVisualizer({
  frequencyData,
  isActive,
  barCount = 32,
  color = '#ef4444',
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      const { width, height } = canvas
      ctx.clearRect(0, 0, width, height)

      if (!isActive || !frequencyData) {
        const centerX = width / 2
        const centerY = height / 2
        const radius = Math.min(width, height) * 0.25
        ctx.beginPath()
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
        ctx.strokeStyle = '#3f3f46'
        ctx.lineWidth = 2
        ctx.stroke()
        return
      }

      const barWidth = (width / barCount) * 0.6
      const gap = (width / barCount) * 0.4
      const step = Math.floor(frequencyData.length / barCount)

      for (let i = 0; i < barCount; i++) {
        const value = frequencyData[i * step] || 0
        const normalizedHeight = (value / 255) * height * 0.85
        const barHeight = Math.max(4, normalizedHeight)
        const x = i * (barWidth + gap) + gap / 2
        const y = (height - barHeight) / 2

        const gradient = ctx.createLinearGradient(x, y, x, y + barHeight)
        gradient.addColorStop(0, color)
        gradient.addColorStop(1, `${color}40`)

        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2)
        ctx.fill()
      }

      animationRef.current = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [frequencyData, isActive, barCount, color])

  return (
    <canvas
      ref={canvasRef}
      width={280}
      height={120}
      className="w-full h-full"
    />
  )
}
