// Ported from the web app's lib/hooks/useLiveLocation.ts. The web version
// used navigator.geolocation.watchPosition; on native we use expo-location's
// permission request + watchPositionAsync. The reporting contract to the
// backend (POST /sessions/:id/location) is identical.
//
// Also starts a *background* location task (see lib/backgroundLocation.ts)
// alongside the foreground watcher. The foreground watcher alone is what
// made this "work in the demo, not in reality" - it stops the instant the
// app isn't in the foreground (screen locked, another app opened, phone in a
// pocket), which is the normal way someone actually carries a phone during a
// safety session. The background task keeps reporting location in that case;
// the foreground watcher is kept too since it fires faster/more precisely
// while the app is actually open.
import { useEffect, useRef, useState } from 'react'
import * as Location from 'expo-location'
import { API_URL } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { LOCATION_TASK_NAME, setActiveLocationTarget } from '@/lib/backgroundLocation'

type LocationStatus = 'idle' | 'watching' | 'denied' | 'error'

export function useLiveLocation(sessionId: string | undefined, active: boolean) {
  const { token } = useAuth()
  const [status, setStatus] = useState<LocationStatus>('idle')
  const [lastSent, setLastSent] = useState<{ lat: number; lng: number } | null>(null)
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null)

  useEffect(() => {
    if (!active || !sessionId || !token) {
      setActiveLocationTarget(null, null)
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

      // Background permission is a *separate* grant from foreground (on
      // Android 10+ / iOS this is a distinct "Allow all the time" prompt).
      // If it's denied, tracking still works via the foreground watcher
      // above - it just pauses whenever the app isn't in front, same as
      // before this fix. If granted, this is what actually keeps a session
      // alive with the phone locked in a pocket.
      const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync()
      if (cancelled) return

      if (backgroundStatus === 'granted') {
        setActiveLocationTarget(sessionId, token)
        const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)
        if (!alreadyRunning) {
          await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
            accuracy: Location.Accuracy.High,
            timeInterval: 15000,
            distanceInterval: 15,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: 'Raahi session active',
              notificationBody: 'Sharing your live location for this safety session.',
            },
          })
        }
      } else {
        console.warn(
          'raahi: background location permission denied - tracking will pause whenever the app is backgrounded'
        )
      }
    }

    void start()

    return () => {
      cancelled = true
      subscriptionRef.current?.remove()
      subscriptionRef.current = null
      setActiveLocationTarget(null, null)
      Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)
        .then((started) => {
          if (started) return Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME)
        })
        .catch(() => {
          // Nothing to clean up if the task was never registered.
        })
    }
  }, [active, sessionId, token])

  return { status, lastSent }
}
