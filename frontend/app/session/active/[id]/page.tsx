'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Header } from '@/components/header'
import { SOSButton } from '@/components/sos-button'
import { StatusBadge } from '@/components/status-badge'
import { BeaconDot } from '@/components/beacon-dot'
import { useSessions, useCheckpoints, useContacts } from '@/lib/hooks'
import { CheckCircle2, AlertCircle, Clock, MapPin, Zap, Home } from 'lucide-react'

export default function SessionActivePage() {
  const params = useParams()
  const router = useRouter()
  const sessionId = params.id as string

  const { sessions, updateSession } = useSessions()
  const { contacts } = useContacts()
  const session = sessions.find((s) => s.id === sessionId)
  const { checkpoints, updateCheckpoint, markCheckpointReached } = useCheckpoints(sessionId)

  const [currentCheckpointIndex, setCurrentCheckpointIndex] = useState(0)
  const [showCountdownModal, setShowCountdownModal] = useState(false)
  const [timeRemaining, setTimeRemaining] = useState(0)
  const [showEscalationModal, setShowEscalationModal] = useState(false)
  const [elapsedTime, setElapsedTime] = useState(0)

  useEffect(() => {
    if (!session) return

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - session.startTime) / 1000)
      setElapsedTime(elapsed)
    }, 1000)

    return () => clearInterval(interval)
  }, [session])

  useEffect(() => {
    if (!showCountdownModal) return

    const remaining = 30 // 30 seconds countdown
    let count = remaining

    const interval = setInterval(() => {
      setTimeRemaining(count)
      count--

      if (count < 0) {
        clearInterval(interval)
        setShowCountdownModal(false)
        setShowEscalationModal(true)
      }
    }, 1000)

    setTimeRemaining(count)
    return () => clearInterval(interval)
  }, [showCountdownModal])

  const handleCompleteSession = () => {
    if (!session) return
    updateSession(sessionId, {
      status: 'completed',
      endTime: Date.now(),
    })
    router.push('/history')
  }

  const handleSOS = () => {
    console.log('[v0] SOS triggered')
    setShowEscalationModal(true)
  }

  const handleMarkCheckpointReached = () => {
    const currentCheckpoint = checkpoints[currentCheckpointIndex]
    if (currentCheckpoint) {
      markCheckpointReached(currentCheckpoint.id)
      if (currentCheckpointIndex < checkpoints.length - 1) {
        setCurrentCheckpointIndex(currentCheckpointIndex + 1)
      }
    }
  }

  const handleTriggerOverdue = () => {
    if (checkpoints[currentCheckpointIndex]) {
      updateCheckpoint(checkpoints[currentCheckpointIndex].id, { status: 'overdue' })
      setShowCountdownModal(true)
    }
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

  const currentCheckpoint = checkpoints[currentCheckpointIndex]
  const sessionContacts = contacts.filter((c) => session.contacts.includes(c.id))
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Session Header */}
      <div className="border-b border-border bg-card sticky top-16 z-40">
        <div className="max-w-4xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">{session.name}</h1>
              <p className="text-sm text-muted-foreground">{session.route}</p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-mono font-bold text-beacon-amber">{formatTime(elapsedTime)}</div>
              <p className="text-xs text-muted-foreground">Elapsed</p>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-4">
            <StatusBadge status={session.status} />
            {process.env.NODE_ENV === 'development' && (
              <button
                onClick={handleTriggerOverdue}
                className="text-xs px-2 py-1 bg-alert-coral/10 text-alert-coral rounded hover:bg-alert-coral/20 transition-colors"
              >
                [DEV] Trigger overdue
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        {/* Mock Map */}
        <div className="mb-8 aspect-video bg-gradient-to-br from-dawn-mist to-card rounded-lg border-2 border-border flex items-center justify-center relative overflow-hidden">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <BeaconDot size="lg" variant="pulse" />
              <p className="text-sm text-muted-foreground mt-4">Live position on route</p>
            </div>
          </div>
        </div>

        {/* Checkpoint Progress */}
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
                      : checkpoint.status === 'overdue'
                        ? 'border-alert-coral bg-alert-coral/5'
                        : 'border-border'
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 mt-1">
                    {checkpoint.status === 'reached' ? (
                      <CheckCircle2 className="text-safe-teal" size={24} />
                    ) : checkpoint.status === 'overdue' ? (
                      <AlertCircle className="text-alert-coral animate-pulse" size={24} />
                    ) : idx === currentCheckpointIndex ? (
                      <BeaconDot size="md" variant="pulse" />
                    ) : (
                      <Clock className="text-muted-foreground" size={24} />
                    )}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-foreground">{checkpoint.name}</h3>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                      <Clock size={16} />
                      <span>{checkpoint.expectedTime} minutes</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPin size={16} />
                      <span className="font-mono">{checkpoint.location.lat}, {checkpoint.location.lng}</span>
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    <StatusBadge status={checkpoint.status} />
                  </div>
                </div>
                {idx === currentCheckpointIndex && checkpoint.status === 'pending' && (
                  <button
                    onClick={handleMarkCheckpointReached}
                    className="mt-4 w-full px-4 py-2 bg-safe-teal text-ink-indigo font-semibold rounded-lg hover:bg-teal-400 transition-colors"
                  >
                    Mark as reached
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Session Complete Button */}
        {checkpoints.every((c) => c.status === 'reached') && (
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

        {/* Contacts Notified */}
        <div>
          <h3 className="text-lg font-bold text-foreground mb-4">Contacts notified</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sessionContacts.map((contact) => (
              <div key={contact.id} className="p-4 bg-card rounded-lg border border-border">
                <p className="font-semibold text-foreground">{contact.name}</p>
                <p className="text-sm text-muted-foreground">{contact.relationship}</p>
                <p className="text-xs font-mono text-muted-foreground mt-2">{contact.phone}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Countdown Modal (Are you OK?) */}
      {showCountdownModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center">
          <div className="w-full max-w-md bg-background rounded-lg p-8 text-center border border-border">
            <div className="mb-8 flex justify-center">
              <div className="relative w-32 h-32">
                <svg className="w-full h-full" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="56" fill="none" stroke="#E5E8F0" strokeWidth="2" />
                  <circle
                    cx="60"
                    cy="60"
                    r="56"
                    fill="none"
                    stroke="#FF4B5C"
                    strokeWidth="2"
                    strokeDasharray={`${(timeRemaining / 30) * 351.86} 351.86`}
                    style={{ transform: 'rotate(-90deg)', transformOrigin: '60px 60px' }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-4xl font-bold text-alert-coral">{timeRemaining}</div>
                    <p className="text-xs text-muted-foreground">seconds</p>
                  </div>
                </div>
              </div>
            </div>

            <h2 className="text-2xl font-bold text-foreground mb-2">Are you OK?</h2>
            <p className="text-muted-foreground mb-8">
              You missed a checkpoint. If everything&apos;s fine, confirm below. Otherwise, we&apos;ll alert your contacts.
            </p>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  setShowCountdownModal(false)
                  handleMarkCheckpointReached()
                }}
                className="w-full px-4 py-3 bg-safe-teal text-ink-indigo font-semibold rounded-lg hover:bg-teal-400 transition-colors"
              >
                I&apos;m OK
              </button>
              <button
                onClick={handleSOS}
                className="w-full px-4 py-3 bg-alert-coral text-white font-semibold rounded-lg hover:bg-red-600 transition-colors flex items-center justify-center gap-2"
              >
                <Zap size={20} />
                Send help
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Escalation Modal */}
      {showEscalationModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center">
          <div className="w-full max-w-md bg-background rounded-lg p-8 text-center border-2 border-alert-coral">
            <div className="mb-6 flex justify-center">
              <AlertCircle className="text-alert-coral animate-pulse" size={48} />
            </div>

            <h2 className="text-2xl font-bold text-alert-coral mb-2">Alerting your contacts</h2>
            <p className="text-muted-foreground mb-6">
              We&apos;re sending notifications to:
            </p>

            <div className="space-y-2 mb-8 text-left">
              {sessionContacts.map((contact) => (
                <div key={contact.id} className="p-3 bg-alert-coral/10 rounded-lg">
                  <p className="font-semibold text-foreground">{contact.name}</p>
                  <p className="text-xs text-muted-foreground">{contact.phone}</p>
                </div>
              ))}
            </div>

            <button
              onClick={() => {
                updateSession(sessionId, { status: 'escalated', endTime: Date.now() })
                setTimeout(() => router.push('/history'), 1500)
              }}
              className="w-full px-4 py-3 bg-beacon-amber text-ink-indigo font-semibold rounded-lg hover:bg-amber-500 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}

      <SOSButton onTrigger={handleSOS} disabled={session.status !== 'active'} />
    </div>
  )
}
