'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, Clock, ExternalLink, Home, MapPin, Zap } from 'lucide-react'
import { BeaconDot } from '@/components/beacon-dot'
import { Header } from '@/components/header'
import { SOSButton } from '@/components/sos-button'
import { StatusBadge } from '@/components/status-badge'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { useContacts } from '@/lib/hooks'
import { useLiveLocation } from '@/lib/hooks/useLiveLocation'
import { useSessionData } from '@/lib/hooks/useSessionData'

export default function SessionActivePage() {
  const params = useParams()
  const router = useRouter()
  const sessionId = params.id as string
  const { token } = useAuth()

  const { session, loading } = useSessionData(sessionId)
  const { contacts } = useContacts()
  const isActive = session?.status === 'active'
  const { status: locationStatus, lastSent } = useLiveLocation(sessionId, isActive)

  const [elapsedTime, setElapsedTime] = useState(0)
  const [showCountdownModal, setShowCountdownModal] = useState(false)
  const [showEscalationModal, setShowEscalationModal] = useState(false)

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

  const handleCompleteSession = async () => {
    await apiFetch(
      `/sessions/${encodeURIComponent(sessionId)}/complete`,
      { method: 'POST' },
      token
    )
    router.push('/history')
  }

  const handleSOS = async () => {
    await apiFetch(
      `/sessions/${encodeURIComponent(sessionId)}/sos`,
      { method: 'POST' },
      token
    )
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
          </div>
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
            <button
              onClick={handleSOS}
              className="w-full px-4 py-3 bg-alert-coral text-white font-semibold rounded-lg hover:bg-red-600 transition-colors flex items-center justify-center gap-2"
            >
              <Zap size={20} />
              Send help now
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

      <SOSButton onTrigger={handleSOS} />
    </div>
  )
}
