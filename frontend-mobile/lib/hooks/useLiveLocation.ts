// Ported from the web app's lib/hooks/useLiveLocation.ts. The web version
// used navigator.geolocation.watchPosition; on native we use expo-location's
// permission request + watchPositionAsync. The reporting contract to the
// backend (POST /sessions/:id/location) is identical.
import { useEffect, useRef, useState } from 'react'
import * as Location from 'expo-location'
import { API_URL } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'

type LocationStatus = 'idle' | 'watching' | 'denied' | 'error'

export function useLiveLocation(sessionId: string | undefined, active: boolean) {
  const { token } = useAuth()
  const [status, setStatus] = useState<LocationStatus>('idle')
  const [lastSent, setLastSent] = useState<{ lat: number; lng: number } | null>(null)
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null)

  useEffect(() => {
    if (!active || !sessionId || !token) {
      setStatus('idle')
      return
    }

    let cancelled = false

    const start = async () => {
      const { status: permissionStatus } = await Location.requestForegroundPermissionsAsync()
      if (cancelled) return

      if (permissionStatus !== 'granted') {
        setStatus('denied')
        return
      }

      subscriptionRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 10000,
          distanceInterval: 10,
        },
        async (position) => {
          const { latitude, longitude } = position.coords

          try {
            const response = await fetch(
              `${API_URL}/sessions/${encodeURIComponent(sessionId)}/location`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ lat: latitude, lng: longitude }),
              }
            )
            if (!response.ok) throw new Error(`Location update failed with status ${response.status}`)

            setStatus('watching')
            setLastSent({ lat: latitude, lng: longitude })
          } catch (error) {
            setStatus('error')
            console.error('failed to send location update', error)
          }
        }
      )
    }

    void start()

    return () => {
      cancelled = true
      subscriptionRef.current?.remove()
      subscriptionRef.current = null
    }
  }, [active, sessionId, token])

  return { status, lastSent }
}
