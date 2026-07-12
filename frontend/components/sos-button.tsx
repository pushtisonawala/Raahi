'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle } from 'lucide-react'

interface SOSButtonProps {
  onTrigger?: () => void
  disabled?: boolean
}

export function SOSButton({ onTrigger, disabled = false }: SOSButtonProps) {
  const [isPressed, setIsPressed] = useState(false)
  const [fillPercent, setFillPercent] = useState(0)
  const pressStartRef = useRef<number | null>(null)
  const holdDurationRef = useRef(1500) // 1.5 seconds

  const handleMouseDown = () => {
    if (disabled) return
    setIsPressed(true)
    pressStartRef.current = Date.now()
  }

  const handleMouseUp = () => {
    setIsPressed(false)
    pressStartRef.current = null
    setFillPercent(0)
  }

  const handleTouchStart = () => {
    if (disabled) return
    setIsPressed(true)
    pressStartRef.current = Date.now()
  }

  const handleTouchEnd = () => {
    setIsPressed(false)
    pressStartRef.current = null
    setFillPercent(0)
  }

  useEffect(() => {
    if (!isPressed) return

    const updateFill = () => {
      if (!pressStartRef.current) return

      const elapsed = Date.now() - pressStartRef.current
      const newFillPercent = Math.min((elapsed / holdDurationRef.current) * 100, 100)
      setFillPercent(newFillPercent)

      if (newFillPercent >= 100) {
        setIsPressed(false)
        pressStartRef.current = null
        setFillPercent(0)
        onTrigger?.()
      } else {
        requestAnimationFrame(updateFill)
      }
    }

    requestAnimationFrame(updateFill)
  }, [isPressed, onTrigger])

  return (
    <button
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      disabled={disabled}
      className="fixed bottom-6 right-6 group"
      aria-label="Send SOS signal"
    >
      <div className="relative w-16 h-16">
        {/* Background circle with fill */}
        <svg className="w-full h-full" viewBox="0 0 64 64">
          {/* Outer ring (unfilled) */}
          <circle
            cx="32"
            cy="32"
            r="30"
            fill="none"
            stroke="rgba(255, 75, 92, 0.2)"
            strokeWidth="2"
          />
          {/* Fill ring (animated) */}
          <circle
            cx="32"
            cy="32"
            r="30"
            fill="none"
            stroke="#FF4B5C"
            strokeWidth="2"
            strokeDasharray={`${(fillPercent / 100) * 188.4} 188.4`}
            style={{ transition: 'stroke-dasharray 0.05s linear' }}
          />
        </svg>

        {/* Main button */}
        <div
          className={`absolute inset-0 flex items-center justify-center rounded-full transition-all duration-200 ${
            isPressed
              ? 'bg-alert-coral scale-90'
              : disabled
                ? 'bg-muted cursor-not-allowed'
                : 'bg-alert-coral hover:bg-red-600 cursor-pointer'
          }`}
        >
          <AlertCircle size={28} className="text-white" />
        </div>

        {/* Pulse ring when not pressed */}
        {!isPressed && !disabled && (
          <div
            className="absolute inset-0 rounded-full bg-alert-coral/20 animate-pulse"
            style={{ animationDuration: '2s' }}
          />
        )}
      </div>

      {/* Tooltip */}
      <div className="absolute bottom-full right-0 mb-3 pointer-events-none">
        <div className="text-xs bg-foreground text-background px-3 py-2 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
          Hold to send SOS
        </div>
      </div>
    </button>
  )
}
