'use client'

import { useEffect, useRef } from 'react'

interface BeaconDotProps {
  size?: 'sm' | 'md' | 'lg'
  intensity?: 'low' | 'normal' | 'high'
  variant?: 'pulse' | 'glow' | 'static'
  className?: string
}

const sizeMap = {
  sm: 12,
  md: 20,
  lg: 32,
}

const sizeClassMap = {
  sm: 'w-3 h-3',
  md: 'w-5 h-5',
  lg: 'w-8 h-8',
}

export function BeaconDot({
  size = 'md',
  intensity = 'normal',
  variant = 'pulse',
  className = '',
}: BeaconDotProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = sizeMap[size] * dpr
    canvas.height = sizeMap[size] * dpr
    ctx.scale(dpr, dpr)

    const centerX = sizeMap[size] / 2
    const centerY = sizeMap[size] / 2
    const radius = sizeMap[size] / 2 - 2

    const animate = () => {
      ctx.clearRect(0, 0, sizeMap[size], sizeMap[size])

      // Draw glow ring if pulse variant
      if (variant === 'pulse' || variant === 'glow') {
        const now = Date.now()
        const glowPulse = Math.sin(now / 1000) * 0.5 + 0.5
        
        // Outer glow ring
        ctx.strokeStyle = `rgba(255, 182, 72, ${glowPulse * 0.3})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(centerX, centerY, radius + 4, 0, Math.PI * 2)
        ctx.stroke()
      }

      // Draw main dot
      ctx.fillStyle = '#FFB648'
      ctx.beginPath()
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
      ctx.fill()

      // Draw subtle inner highlight
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
      ctx.beginPath()
      ctx.arc(centerX - radius / 3, centerY - radius / 3, radius / 3, 0, Math.PI * 2)
      ctx.fill()

      requestAnimationFrame(animate)
    }

    animate()
  }, [size, variant])

  return (
    <canvas
      ref={canvasRef}
      className={`${sizeClassMap[size]} ${className}`}
      style={{ display: 'block' }}
    />
  )
}
