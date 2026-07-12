'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Header } from '@/components/header'
import { StatusBadge } from '@/components/status-badge'
import { useSessions } from '@/lib/hooks'
import { MapPin, Clock, AlertCircle } from 'lucide-react'

export default function HistoryPage() {
  const { sessions } = useSessions()
  const [filterStatus, setFilterStatus] = useState<'all' | 'completed' | 'escalated'>('all')

  const filteredSessions =
    filterStatus === 'all' ? sessions : sessions.filter((s) => s.status === filterStatus)

  const sortedSessions = [...filteredSessions].reverse()

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)

    if (hours > 0) {
      return `${hours}h ${minutes}m`
    }
    return `${minutes}m`
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <div className="max-w-4xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Session history</h1>
          <p className="text-muted-foreground">Your past check-ins and safety sessions</p>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-8">
          {(['all', 'completed', 'escalated'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors capitalize ${
                filterStatus === status
                  ? 'bg-beacon-amber text-ink-indigo'
                  : 'bg-muted text-foreground hover:bg-muted/80'
              }`}
            >
              {status}
            </button>
          ))}
        </div>

        {/* Sessions List */}
        {sortedSessions.length > 0 ? (
          <div className="space-y-4">
            {sortedSessions.map((session, idx) => {
              const duration = session.endTime ? session.endTime - session.startTime : 0
              const hasEscalation = session.checkpoints.some((c) => c.status === 'overdue')

              return (
                <div
                  key={session.id}
                  className={`p-6 rounded-lg border transition-all ${
                    session.status === 'escalated'
                      ? 'bg-alert-coral/5 border-alert-coral/50'
                      : 'bg-card border-border hover:border-beacon-amber/50'
                  }`}
                >
                  {/* Timeline indicator */}
                  <div className="flex gap-6">
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-4 h-4 rounded-full border-2 ${
                          session.status === 'escalated'
                            ? 'bg-alert-coral border-alert-coral'
                            : 'bg-safe-teal border-safe-teal'
                        }`}
                      />
                      {idx < sortedSessions.length - 1 && (
                        <div
                          className={`w-1 h-16 ${
                            session.status === 'escalated'
                              ? 'bg-alert-coral/30'
                              : 'bg-safe-teal/30'
                          }`}
                        />
                      )}
                    </div>

                    {/* Session details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="text-lg font-bold text-foreground">{session.name}</h3>
                          <p className="text-sm text-muted-foreground">{session.route}</p>
                        </div>
                        <StatusBadge status={session.status} />
                      </div>

                      {/* Metadata */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm mt-4 p-3 bg-muted/50 rounded-lg">
                        <div>
                          <p className="text-xs text-muted-foreground">Date</p>
                          <p className="font-medium text-foreground">{formatDate(session.createdAt)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Duration</p>
                          <p className="font-medium text-foreground">{formatTime(duration)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Checkpoints</p>
                          <p className="font-medium text-foreground">{session.checkpoints.length}</p>
                        </div>
                      </div>

                      {/* Checkpoint Summary */}
                      {session.checkpoints.length > 0 && (
                        <div className="mt-4">
                          <p className="text-xs font-medium text-muted-foreground mb-2">Checkpoints:</p>
                          <div className="space-y-2">
                            {session.checkpoints.map((checkpoint) => (
                              <div
                                key={checkpoint.id}
                                className="flex items-center gap-3 text-sm p-2 bg-muted/30 rounded"
                              >
                                {checkpoint.status === 'overdue' ? (
                                  <AlertCircle className="text-alert-coral" size={16} />
                                ) : checkpoint.status === 'reached' ? (
                                  <div className="w-4 h-4 rounded-full bg-safe-teal" />
                                ) : (
                                  <div className="w-4 h-4 rounded-full bg-muted" />
                                )}
                                <span className="font-medium text-foreground flex-1">{checkpoint.name}</span>
                                <span className="text-muted-foreground">{checkpoint.expectedTime}m</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {hasEscalation && (
                        <div className="mt-4 p-3 bg-alert-coral/10 border border-alert-coral/30 rounded-lg flex items-start gap-3">
                          <AlertCircle className="text-alert-coral flex-shrink-0 mt-0.5" size={18} />
                          <div>
                            <p className="text-xs font-medium text-alert-coral">Emergency escalation</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Contacts were notified due to missed checkpoints.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-12 bg-card rounded-lg border-2 border-dashed border-border">
            <Clock className="mx-auto mb-4 text-muted-foreground" size={40} />
            <h2 className="text-lg font-semibold text-foreground mb-2">No session history</h2>
            <p className="text-muted-foreground mb-6">
              {filterStatus === 'all'
                ? "You haven't started any sessions yet."
                : `No ${filterStatus} sessions yet.`}
            </p>
            <Link
              href="/session/new"
              className="inline-block px-4 py-2 bg-beacon-amber text-ink-indigo font-semibold rounded-lg hover:bg-amber-500 transition-colors"
            >
              Create your first session
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
