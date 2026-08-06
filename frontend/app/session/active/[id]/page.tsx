'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, Clock, ExternalLink, Home, MapPin, RefreshCw, Zap } from 'lucide-react'
import { BeaconDot } from '@/components/beacon-dot'
import { Header } from '@/components/header'
import { SOSButton } from '@/components/sos-button'
import { StatusBadge } from '@/components/status-badge'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { useContacts } from '@/lib/hooks'
import { useLiveLocation } from '@/lib/hooks/useLiveLocation'
import { useSessionData } from '@/lib/hooks/useSessionData'
import { getRouteCheckpoints } from '@/lib/route'

// How many consecutive off-route location pings (each ~10-15s apart, see
// useLiveLocation) it takes before we auto-reroute, and how long to wait
// after a reroute before trying again. The original design just froze
// progress the moment you were more than 60m from the one path OSRM picked
// at session start - fine if you walk that exact path, wrong the moment you
// take a shortcut, a different street, or a closed road gets in the way.
// Requiring a streak (not a single ping) avoids rerouting on one noisy GPS
// blip; the cooldown avoids hammering the routing API/backend if deviation
// persists across many pings in a row.
const OFF_ROUTE_STREAK_THRESHOLD = 3
const REROUTE_COOLDOWN_MS = 60_000

// Each checkpoint already carries a real expected_time from the routing
// API's own per-segment timing (see lib/route.ts) - it just wasn't shown
// anywhere once a session was actually running, only during setup. This
// turns that into "~8 min (by 3:45 PM)" while still ahead of it, or
// "3:40 PM (5 min ago)" once it's passed, which doubles as a plain-language
// answer to "how much time should I take to reach there."
function formatExpectedTime(iso: string | null): string | null {
  if (!iso) return null
  const target = new Date(iso)
  if (Number.isNaN(target.getTime())) return null

  const diffMinutes = Math.round((target.getTime() - Date.now()) / 60000)
  const clock = target.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  if (diffMinutes > 0) return `~${diffMinutes} min (by ${clock})`
  if (diffMinutes < 0) return `${clock} (${Math.abs(diffMinutes)} min ago)`
  return `by ${clock}`
}

export default function SessionActivePage() {
  const params = useParams()
  const router = useRouter()
  const sessionId = params.id as string
  const { token } = useAuth()

  const { session, loading } = useSessionData(sessionId)
  const { contacts } = useContacts()
  // Keep sending location updates through 'sos_triggered' too, not just
  // 'active' - stopping live tracking the instant someone asks for help is
  // exactly backwards for a safety app; that's when your contacts most need
  // an up-to-date position, not a frozen one.
  const isActive = session?.status === 'active' || session?.status === 'sos_triggered'
  const { status: locationStatus, lastSent } = useLiveLocation(sessionId, isActive)

  const [elapsedTime, setElapsedTime] = useState(0)
  const [showCountdownModal, setShowCountdownModal] = useState(false)
  const [showEscalationModal, setShowEscalationModal] = useState(false)
  const [isSendingSOS, setIsSendingSOS] = useState(false)
  const [sosError, setSosError] = useState<string | null>(null)
  const [isRerouting, setIsRerouting] = useState(false)
  const [rerouteError, setRerouteError] = useState<string | null>(null)
  const offRouteStreakRef = useRef(0)
  const lastRerouteAtRef = useRef(0)

  const checkpoints = session?.checkpoints ?? []
  const currentCheckpointIndex = useMemo(
    () => checkpoints.findIndex((checkpoint) => checkpoint.status !== 'reached'),
    [checkpoints]
  )
  const liveMapUrl = useMemo(() => {
    if (!lastSent) return null

    const offset = 0.008
    const bbox = [
      lastSent.lng - offset,
      lastSent.lat - offset,
      lastSent.lng + offset,
      lastSent.lat + offset,
    ].join(',')
    return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${lastSent.lat},${lastSent.lng}`)}`
  }, [lastSent])

  useEffect(() => {
    if (!session) return

    const start = new Date(session.started_at).getTime()
    const updateElapsedTime = () => {
      setElapsedTime(Math.max(0, Math.floor((Date.now() - start) / 1000)))
    }

    updateElapsedTime()
    const interval = setInterval(updateElapsedTime, 1000)
    return () => clearInterval(interval)
  }, [session])

  useEffect(() => {
    setShowCountdownModal(checkpoints.some((checkpoint) => checkpoint.status === 'pinged'))
    setShowEscalationModal(
      checkpoints.some((checkpoint) => checkpoint.status === 'contacts_alerted')
    )
  }, [checkpoints])

  // Recomputes a route from wherever the walker currently is to the same
  // destination, using the exact same lib/route.ts lookup the wizard used to
  // build the original route (same mode, same mismatch/pace validation,
  // same traffic buffer for driving), then hands it to the backend's
  // /reroute endpoint to swap in as the new plan. This is what turns
  // "off route" from a dead end into "recalculating," the way turn-by-turn
  // nav apps behave.
  const handleReroute = async (destLat: number, destLng: number) => {
    if (!lastSent) return
    setIsRerouting(true)
    setRerouteError(null)
    try {
      const mode = session?.travel_mode === 'driving' ? 'driving' : 'walking'
      const result = await getRouteCheckpoints(
        lastSent.lat,
        lastSent.lng,
        destLat,
        destLng,
        new Date(),
        mode
      )
      await apiFetch(
        `/sessions/${encodeURIComponent(sessionId)}/reroute`,
        {
          method: 'POST',
          body: JSON.stringify({
            checkpoints: result.checkpoints,
            route_geometry: result.geometry,
          }),
        },
        token
      )
      // The backend broadcasts a websocket event on success, which
      // useSessionData's onmessage handler picks up to refetch - no manual
      // refresh needed here.
    } catch (error) {
      setRerouteError(
        error instanceof Error ? error.message : 'Could not recalculate the route.'
      )
    } finally {
      setIsRerouting(false)
    }
  }

  useEffect(() => {
    if (!session || session.status !== 'active' || !lastSent) {
      offRouteStreakRef.current = 0
      return
    }
    if (!session.route_total_meters) return // no route to recalculate against

    if (!session.route_deviation) {
      offRouteStreakRef.current = 0
      return
    }

    offRouteStreakRef.current += 1
    if (offRouteStreakRef.current < OFF_ROUTE_STREAK_THRESHOLD) return
    if (isRerouting) return
    if (Date.now() - lastRerouteAtRef.current < REROUTE_COOLDOWN_MS) return

    const destination = session.checkpoints.find((checkpoint) => checkpoint.name === 'Destination')
    if (!destination || destination.lat === null || destination.lng === null) return

    offRouteStreakRef.current = 0
    lastRerouteAtRef.current = Date.now()
    void handleReroute(destination.lat, destination.lng)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, lastSent, isRerouting])

  const handleCompleteSession = async () => {
    await apiFetch(
      `/sessions/${encodeURIComponent(sessionId)}/complete`,
      { method: 'POST' },
      token
    )
    router.push('/history')
  }

  const handleSOS = async () => {
    if (isSendingSOS) return
    // The old version awaited this with no try/catch at all - a failed
    // request (network blip, expired token, backend hiccup) just vanished
    // with zero feedback, which is exactly why pressing SOS could feel like
    // "nothing happened." Now a failure surfaces immediately and can be
    // retried, and success shows an unmistakable confirmation instead of
    // only a small status-badge change.
    setIsSendingSOS(true)
    setSosError(null)
    try {
      await apiFetch(
        `/sessions/${encodeURIComponent(sessionId)}/sos`,
        { method: 'POST' },
        token
      )
    } catch (error) {
      setSosError(
        error instanceof Error
          ? error.message
          : 'Could not reach the server. Check your connection and try again.'
      )
    } finally {
      setIsSendingSOS(false)
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading session...</p>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="mx-auto mb-4 text-muted-foreground" size={48} />
          <p className="text-muted-foreground mb-4">Session not found</p>
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2 bg-beacon-amber text-ink-indigo rounded-lg font-semibold"
          >
            Return home
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <div className="border-b border-border bg-card sticky top-16 z-40">
        <div className="max-w-4xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">{session.name}</h1>
              {session.route && <p className="text-sm text-muted-foreground">{session.route}</p>}
              {locationStatus === 'denied' && (
                <p className="text-xs text-alert-coral mt-1">
                  Location access denied - live tracking is off
                </p>
              )}
            </div>
            <div className="text-right">
              <div className="text-3xl font-mono font-bold text-beacon-amber">
                {formatTime(elapsedTime)}
              </div>
              <p className="text-xs text-muted-foreground">Elapsed</p>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-4">
            <StatusBadge status={session.status} />
            {isRerouting ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-alert-coral/10 px-3 py-1 text-xs font-medium text-alert-coral">
                <RefreshCw size={12} className="animate-spin" />
                Recalculating route...
              </span>
            ) : (
              session.route_deviation && (
                <span className="inline-flex items-center gap-1 rounded-full bg-alert-coral/10 px-3 py-1 text-xs font-medium text-alert-coral">
                  <AlertCircle size={12} />
                  Off route
                </span>
              )
            )}
          </div>
          {rerouteError && <p className="text-xs text-alert-coral mt-2">{rerouteError}</p>}
          {session.route_total_meters ? (
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>Route progress</span>
                <span>
                  {Math.round(
                    (Math.min(session.progress_meters, session.route_total_meters) /
                      session.route_total_meters) *
                      100
                  )}
                  %
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-2 rounded-full bg-safe-teal transition-all duration-500"
                  style={{
                    width: `${Math.min(100, (session.progress_meters / session.route_total_meters) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-8 aspect-video bg-muted rounded-lg border-2 border-border relative overflow-hidden">
          {liveMapUrl && lastSent ? (
            <>
              <iframe
                key={liveMapUrl}
                src={liveMapUrl}
                title="Current live location"
                className="absolute inset-0 h-full w-full border-0"
              />
              <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md bg-background/95 px-3 py-2 text-xs font-medium text-foreground shadow-sm">
                <BeaconDot size="sm" variant="pulse" />
                Live
              </div>
              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-3 rounded-md bg-background/95 px-3 py-2 shadow-sm">
                <span className="truncate font-mono text-xs text-foreground">
                  {lastSent.lat.toFixed(6)}, {lastSent.lng.toFixed(6)}
                </span>
                <a
                  href={`https://www.openstreetmap.org/?mlat=${lastSent.lat}&mlon=${lastSent.lng}#map=17/${lastSent.lat}/${lastSent.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 p-1 text-beacon-amber hover:text-amber-600"
                  aria-label="Open location in OpenStreetMap"
                  title="Open in OpenStreetMap"
                >
                  <ExternalLink size={18} />
                </a>
              </div>
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center px-6">
              <div className="text-center">
                {locationStatus === 'denied' || locationStatus === 'error' ? (
                  <AlertCircle className="mx-auto text-alert-coral" size={36} />
                ) : (
                  <BeaconDot size="lg" variant="pulse" />
                )}
                <p className="mt-4 text-sm font-medium text-foreground">
                  {locationStatus === 'denied'
                    ? 'Location permission is blocked'
                    : locationStatus === 'error'
                      ? 'Unable to update your location'
                      : isActive
                        ? 'Waiting for your location...'
                        : 'Location tracking has stopped'}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="mb-12">
          <h2 className="text-lg font-bold text-foreground mb-6">Checkpoints</h2>
          <div className="space-y-3">
            {checkpoints.map((checkpoint, idx) => (
              <div
                key={checkpoint.id}
                className={`p-4 rounded-lg border transition-all ${
                  idx === currentCheckpointIndex
                    ? 'border-beacon-amber bg-beacon-amber/5'
                    : checkpoint.status === 'reached'
                      ? 'border-safe-teal bg-safe-teal/5'
                      : checkpoint.status === 'overdue' || checkpoint.status === 'pinged'
                        ? 'border-alert-coral bg-alert-coral/5'
                        : 'border-border'
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 mt-1">
                    {checkpoint.status === 'reached' ? (
                      <CheckCircle2 className="text-safe-teal" size={24} />
                    ) : checkpoint.status === 'overdue' || checkpoint.status === 'pinged' ? (
                      <AlertCircle className="text-alert-coral animate-pulse" size={24} />
                    ) : idx === currentCheckpointIndex ? (
                      <BeaconDot size="md" variant="pulse" />
                    ) : (
                      <Clock className="text-muted-foreground" size={24} />
                    )}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-foreground">{checkpoint.name}</h3>
                    {formatExpectedTime(checkpoint.expected_time) && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Clock size={16} />
                        <span>{formatExpectedTime(checkpoint.expected_time)}</span>
                      </div>
                    )}
                    {checkpoint.lat !== null && checkpoint.lng !== null && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin size={16} />
                        <span className="font-mono">
                          {checkpoint.lat.toFixed(4)}, {checkpoint.lng.toFixed(4)}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    <StatusBadge status={checkpoint.status} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {checkpoints.length > 0 && checkpoints.every((checkpoint) => checkpoint.status === 'reached') && (
          <div className="mb-8 p-6 bg-card rounded-lg border-2 border-safe-teal">
            <h3 className="font-semibold text-foreground mb-2">All checkpoints reached!</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Great job! You&apos;re safe. Let your contacts know you&apos;ve arrived.
            </p>
            <button
              onClick={handleCompleteSession}
              className="w-full px-4 py-3 bg-safe-teal text-ink-indigo font-semibold rounded-lg hover:bg-teal-400 transition-colors flex items-center justify-center gap-2"
            >
              <Home size={20} />
              Complete session
            </button>
          </div>
        )}

        <div>
          <h3 className="text-lg font-bold text-foreground mb-4">Your trusted contacts</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {contacts.map((contact) => (
              <div key={contact.id} className="p-4 bg-card rounded-lg border border-border">
                <p className="font-semibold text-foreground">{contact.name}</p>
                <p className="text-sm text-muted-foreground">{contact.relationship}</p>
                <p className="text-xs font-mono text-muted-foreground mt-2">{contact.phone}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showCountdownModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center">
          <div className="w-full max-w-md bg-background rounded-lg p-8 text-center border border-border">
            <div className="mb-6">
              <AlertCircle className="mx-auto text-alert-coral" size={48} />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">Are you OK?</h2>
            <p className="text-muted-foreground mb-8">
              You missed a checkpoint. Walk or update your location to confirm you&apos;re fine -
              otherwise we&apos;ll alert your contacts shortly.
            </p>
            {sosError && <p className="text-sm text-alert-coral mb-4">{sosError}</p>}
            <button
              onClick={() => void handleSOS()}
              disabled={isSendingSOS}
              className="w-full px-4 py-3 bg-alert-coral text-white font-semibold rounded-lg hover:bg-red-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Zap size={20} />
              {isSendingSOS ? 'Sending...' : 'Send help now'}
            </button>
          </div>
        </div>
      )}

      {showEscalationModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center">
          <div className="w-full max-w-md bg-background rounded-lg p-8 text-center border-2 border-alert-coral">
            <div className="mb-6 flex justify-center">
              <AlertCircle className="text-alert-coral animate-pulse" size={48} />
            </div>
            <h2 className="text-2xl font-bold text-alert-coral mb-2">
              Your contacts have been alerted
            </h2>
            <p className="text-muted-foreground mb-6">
              We emailed your trusted contacts with your last known location.
            </p>
            <button
              onClick={() => router.push('/history')}
              className="w-full px-4 py-3 bg-beacon-amber text-ink-indigo font-semibold rounded-lg hover:bg-amber-500 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Pressing SOS used to give no confirmation beyond a small status-badge
          text change - easy to miss, which is exactly why it could feel like
          "nothing happened" even when the request succeeded. This modal is
          unmissable and stays up until dismissed. */}
      {session.status === 'sos_triggered' && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center">
          <div className="w-full max-w-md bg-background rounded-lg p-8 text-center border-2 border-alert-coral">
            <div className="mb-6 flex justify-center">
              <Zap className="text-alert-coral" size={48} />
            </div>
            <h2 className="text-2xl font-bold text-alert-coral mb-2">SOS sent</h2>
            <p className="text-muted-foreground mb-6">
              Your trusted contacts have been emailed with your last known location. Live tracking
              is still on - stay where you are if it&apos;s safe to do so.
            </p>
            <button
              onClick={() => router.push('/history')}
              className="w-full px-4 py-3 bg-beacon-amber text-ink-indigo font-semibold rounded-lg hover:bg-amber-500 transition-colors"
            >
              OK
            </button>
          </div>
        </div>
      )}

      <SOSButton onTrigger={() => void handleSOS()} disabled={isSendingSOS} />
    </div>
  )
}
