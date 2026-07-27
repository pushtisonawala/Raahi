'use client'

import { useEffect, useRef, useState } from 'react'
import { API_URL } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'

type LocationStatus = 'idle' | 'watching' | 'denied' | 'error'

export function useLiveLocation(sessionId: string | undefined, active: boolean) {
  const { token } = useAuth()
  const [status, setStatus] = useState<LocationStatus>('idle')
  const [lastSent, setLastSent] = useState<{ lat: number; lng: number } | null>(null)
  const watchIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!active || !sessionId || !token) {
      setStatus('idle')
      return
    }

    if (!('geolocation' in navigator)) {
      setStatus('error')
      return
    }

    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const { latitude, longitude } = position.coords

        try {
          const response = await fetch(`${API_URL}/sessions/${encodeURIComponent(sessionId)}/location`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ lat: latitude, lng: longitude }),
          })
          if (!response.ok) throw new Error(`Location update failed with status ${response.status}`)

          setStatus('watching')
          setLastSent({ lat: latitude, lng: longitude })
        } catch (error) {
          setStatus('error')
          console.error('failed to send location update', error)
        }
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setStatus('denied')
        } else {
          setStatus('error')
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 20000,
      }
    )

    watchIdRef.current = watchId

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [active, sessionId, token])

  return { status, lastSent }
}
