// Registers the background location task that keeps a safety session's
// tracking alive once the app isn't in the foreground - screen locked, phone
// in a pocket, another app opened. That's the realistic way this gets used
// (nobody keeps the app open and staring at the screen the whole walk), but
// the original implementation only used Location.watchPositionAsync, which
// stops firing the moment the app backgrounds. That's the actual cause of
// "worked fine in the demo but not when I really used it" - the demo was a
// short walk with the phone in hand and the screen on the whole time.
//
// TaskManager.defineTask has to run at module scope (not inside a React
// component) so the OS can invoke it even if the app was relaunched into the
// background by iOS/Android's location services without any screen ever
// having been shown. Because of that, this task can't reach into React state
// for "which session, whose auth token" - it reads whatever was last set via
// setActiveLocationTarget, which useLiveLocation calls whenever a session
// tracking window starts or ends.
import * as TaskManager from 'expo-task-manager'
import * as Location from 'expo-location'
import { API_URL } from './api'

export const LOCATION_TASK_NAME = 'raahi-background-location'

let activeSessionId: string | null = null
let activeToken: string | null = null

export function setActiveLocationTarget(sessionId: string | null, token: string | null) {
  activeSessionId = sessionId
  activeToken = token
}

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('background location task error', error)
    return
  }
  if (!activeSessionId || !activeToken) return

  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations
  const latest = locations?.[locations.length - 1]
  if (!latest) return

  try {
    const response = await fetch(
      `${API_URL}/sessions/${encodeURIComponent(activeSessionId)}/location`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${activeToken}`,
        },
        body: JSON.stringify({
          lat: latest.coords.latitude,
          lng: latest.coords.longitude,
        }),
      }
    )
    if (!response.ok) {
      console.error(`background location update failed with status ${response.status}`)
    }
  } catch (sendError) {
    console.error('background location send failed', sendError)
  }
})
