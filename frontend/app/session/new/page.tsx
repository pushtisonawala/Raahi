'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/header'
import { useSessions, useContacts } from '@/lib/hooks'
import { ArrowRight, ArrowLeft, Plus, X, GripVertical } from 'lucide-react'
import type { Checkpoint, Session } from '@/lib/types'

export default function SessionNewPage() {
  const router = useRouter()
  const { createSession } = useSessions()
  const { contacts } = useContacts()

  const [step, setStep] = useState(1)
  const [sessionName, setSessionName] = useState('')
  const [route, setRoute] = useState('')
  const [gracePeriod, setGracePeriod] = useState(5)
  const [selectedContacts, setSelectedContacts] = useState<string[]>([])
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [newCheckpoint, setNewCheckpoint] = useState({ name: '', expectedTime: 10, lat: 0, lng: 0 })
  const [draggedId, setDraggedId] = useState<string | null>(null)

  const handleAddCheckpoint = () => {
    if (!newCheckpoint.name) return
    const checkpoint: Checkpoint = {
      id: Date.now().toString(),
      name: newCheckpoint.name,
      expectedTime: newCheckpoint.expectedTime,
      location: { lat: newCheckpoint.lat, lng: newCheckpoint.lng },
      status: 'pending',
    }
    setCheckpoints([...checkpoints, checkpoint])
    setNewCheckpoint({ name: '', expectedTime: 10, lat: 0, lng: 0 })
  }

  const handleDeleteCheckpoint = (id: string) => {
    setCheckpoints(checkpoints.filter((c) => c.id !== id))
  }

  const handleDragStart = (id: string) => {
    setDraggedId(id)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return

    const draggedIndex = checkpoints.findIndex((c) => c.id === draggedId)
    const targetIndex = checkpoints.findIndex((c) => c.id === targetId)

    const newCheckpoints = [...checkpoints]
    newCheckpoints.splice(draggedIndex, 1)
    newCheckpoints.splice(targetIndex, 0, checkpoints[draggedIndex])

    setCheckpoints(newCheckpoints)
    setDraggedId(null)
  }

  const handleToggleContact = (contactId: string) => {
    setSelectedContacts((prev) =>
      prev.includes(contactId) ? prev.filter((id) => id !== contactId) : [...prev, contactId]
    )
  }

  const handleSubmit = () => {
    if (!sessionName || !route || checkpoints.length === 0 || selectedContacts.length === 0) {
      alert('Please complete all steps')
      return
    }

    const session: Omit<Session, 'id' | 'createdAt'> = {
      name: sessionName,
      route,
      checkpoints,
      contacts: selectedContacts,
      status: 'active',
      gracePeriod,
      startTime: Date.now(),
    }

    const created = createSession(session)
    router.push(`/session/active/${created.id}`)
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <div className="max-w-2xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        {/* Progress Indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-3xl font-bold text-foreground">New session</h1>
            <span className="text-sm font-medium text-muted-foreground">Step {step} of 5</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className="h-2 bg-beacon-amber rounded-full transition-all duration-300"
              style={{ width: `${(step / 5) * 100}%` }}
            />
          </div>
        </div>

        {/* Step 1: Session Name */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Session name</label>
              <input
                type="text"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                placeholder="e.g., Downtown exploration, Morning jog"
                className="w-full px-4 py-3 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-beacon-amber"
              />
              <p className="text-xs text-muted-foreground mt-2">Give your session a descriptive name</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Route or area</label>
              <input
                type="text"
                value={route}
                onChange={(e) => setRoute(e.target.value)}
                placeholder="e.g., Central Park loop, Beach walk"
                className="w-full px-4 py-3 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-beacon-amber"
              />
              <p className="text-xs text-muted-foreground mt-2">Where will you be?</p>
            </div>
          </div>
        )}

        {/* Step 2: Checkpoints */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-foreground mb-4">Add checkpoints</label>
              <div className="space-y-3 mb-4">
                <div>
                  <input
                    type="text"
                    value={newCheckpoint.name}
                    onChange={(e) => setNewCheckpoint({ ...newCheckpoint, name: e.target.value })}
                    placeholder="Checkpoint name (e.g., Park entrance)"
                    className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-beacon-amber text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Expected time (min)</label>
                    <input
                      type="number"
                      min="1"
                      value={newCheckpoint.expectedTime}
                      onChange={(e) =>
                        setNewCheckpoint({ ...newCheckpoint, expectedTime: parseInt(e.target.value) || 1 })
                      }
                      className="w-full px-3 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-beacon-amber text-sm"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={handleAddCheckpoint}
                      className="w-full px-3 py-2 bg-beacon-amber text-ink-indigo rounded-lg font-medium hover:bg-amber-500 transition-colors text-sm flex items-center justify-center gap-2"
                    >
                      <Plus size={16} />
                      Add
                    </button>
                  </div>
                </div>
              </div>

              {checkpoints.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Checkpoints (drag to reorder):</p>
                  <div className="space-y-2">
                    {checkpoints.map((checkpoint) => (
                      <div
                        key={checkpoint.id}
                        draggable
                        onDragStart={() => handleDragStart(checkpoint.id)}
                        onDragOver={handleDragOver}
                        onDrop={() => handleDrop(checkpoint.id)}
                        className="flex items-center gap-3 p-3 bg-muted rounded-lg cursor-grab active:cursor-grabbing"
                      >
                        <GripVertical size={16} className="text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-foreground truncate">{checkpoint.name}</p>
                          <p className="text-xs text-muted-foreground">{checkpoint.expectedTime} min</p>
                        </div>
                        <button
                          onClick={() => handleDeleteCheckpoint(checkpoint.id)}
                          className="p-2 hover:bg-alert-coral/10 text-alert-coral rounded-md transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 3: Grace Period */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Grace period</label>
              <div className="flex items-end gap-4">
                <div className="flex-1">
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={gracePeriod}
                    onChange={(e) => setGracePeriod(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-4 py-3 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-beacon-amber"
                  />
                </div>
                <span className="text-sm text-muted-foreground pb-3">
                  {gracePeriod === 1 ? 'minute' : 'minutes'}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-4 p-3 bg-card rounded-lg">
                <strong>Plain language:</strong> If you&apos;re {gracePeriod} minute{gracePeriod === 1 ? '' : 's'} late reaching a checkpoint, we&apos;ll check on you before contacting anyone. This gives you time to get back on track.
              </p>
            </div>
          </div>
        )}

        {/* Step 4: Select Contacts */}
        {step === 4 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-foreground mb-4">
                Who should we contact if needed?
              </label>
              {contacts.length > 0 ? (
                <div className="space-y-3">
                  {contacts.map((contact) => (
                    <div
                      key={contact.id}
                      className="flex items-center gap-3 p-4 border border-border rounded-lg hover:border-beacon-amber/50 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedContacts.includes(contact.id)}
                        onChange={() => handleToggleContact(contact.id)}
                        className="w-5 h-5 accent-beacon-amber rounded cursor-pointer"
                      />
                      <div className="flex-1">
                        <p className="font-medium text-foreground">{contact.name}</p>
                        <p className="text-sm text-muted-foreground">{contact.relationship}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 bg-card rounded-lg border border-border">
                  <p className="text-muted-foreground mb-4">No trusted contacts yet</p>
                  <a href="/contacts" className="text-beacon-amber hover:underline font-semibold text-sm">
                    Add contacts first
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 5: Review */}
        {step === 5 && (
          <div className="space-y-6">
            <div className="bg-card rounded-lg border border-border p-6 space-y-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase">Session name</p>
                <p className="text-lg font-semibold text-foreground mt-1">{sessionName}</p>
              </div>
              <div className="border-t border-border pt-4">
                <p className="text-xs font-medium text-muted-foreground uppercase">Route</p>
                <p className="text-foreground mt-1">{route}</p>
              </div>
              <div className="border-t border-border pt-4">
                <p className="text-xs font-medium text-muted-foreground uppercase">Checkpoints</p>
                <p className="text-foreground mt-1">{checkpoints.length} waypoints</p>
              </div>
              <div className="border-t border-border pt-4">
                <p className="text-xs font-medium text-muted-foreground uppercase">Grace period</p>
                <p className="text-foreground mt-1">{gracePeriod} minutes</p>
              </div>
              <div className="border-t border-border pt-4">
                <p className="text-xs font-medium text-muted-foreground uppercase">Contacts</p>
                <p className="text-foreground mt-1">
                  {selectedContacts.length} {selectedContacts.length === 1 ? 'person' : 'people'} notified
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center gap-4 mt-8 pt-6 border-t border-border">
          <button
            onClick={() => setStep(Math.max(1, step - 1))}
            disabled={step === 1}
            className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg font-semibold hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowLeft size={20} />
            Back
          </button>
          <div className="flex-1" />
          {step < 5 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={
                (step === 1 && (!sessionName || !route)) ||
                (step === 2 && checkpoints.length === 0) ||
                (step === 4 && selectedContacts.length === 0)
              }
              className="flex items-center gap-2 px-6 py-2 bg-beacon-amber text-ink-indigo rounded-lg font-semibold hover:bg-amber-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
              <ArrowRight size={20} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              className="flex items-center gap-2 px-6 py-2 bg-safe-teal text-ink-indigo rounded-lg font-semibold hover:bg-teal-400 transition-colors"
            >
              Start session
              <ArrowRight size={20} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
