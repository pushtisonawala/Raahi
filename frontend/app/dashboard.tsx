'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowRight, LoaderCircle, MapPin, RefreshCw } from 'lucide-react'
import { Header } from '@/components/header'
import { SOSButton } from '@/components/sos-button'
import { StatusBadge } from '@/components/status-badge'
import { BeaconDot } from '@/components/beacon-dot'
import { useContacts, useSessions } from '@/lib/hooks'

export function Dashboard() {
  const { contacts, loading: contactsLoading, error: contactsError, refresh } = useContacts()
  const { sessions } = useSessions()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const recentSessions = sessions.slice(-3).reverse()
  const displayContacts = contacts.slice(0, 3)

  if (!mounted) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-dawn-mist to-background px-4 py-12 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <div className="mb-6 flex justify-center">
            <BeaconDot size="lg" variant="pulse" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4 text-balance">
            You don&apos;t walk alone
          </h1>
          <p className="text-lg text-muted-foreground mb-8 text-balance">
            Stay connected with trusted people while you move through the world. Proactive check-ins keep everyone at ease.
          </p>
          <Link
            href="/session/new"
            className="inline-flex items-center gap-2 px-6 py-3 bg-beacon-amber text-ink-indigo font-semibold rounded-lg hover:bg-amber-500 transition-colors"
          >
            Start a session
            <ArrowRight size={20} />
          </Link>
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        {/* Trusted Contacts */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">Trusted contacts</h2>
          {contactsLoading ? (
            <div className="flex min-h-32 items-center justify-center" role="status">
              <LoaderCircle className="animate-spin text-beacon-amber" size={24} />
              <span className="sr-only">Loading contacts</span>
            </div>
          ) : contactsError ? (
            <div className="flex items-center gap-3 rounded-lg border border-alert-coral/30 bg-alert-coral/10 p-4">
              <AlertCircle className="shrink-0 text-alert-coral" size={20} />
              <p className="flex-1 text-sm text-foreground">{contactsError}</p>
              <button
                type="button"
                onClick={() => void refresh()}
                className="p-2 text-alert-coral hover:bg-alert-coral/10 rounded-md"
                aria-label="Retry loading contacts"
                title="Retry"
              >
                <RefreshCw size={18} />
              </button>
            </div>
          ) : displayContacts.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {displayContacts.map((contact) => (
                <div
                  key={contact.id}
                  className="p-4 bg-card rounded-lg border border-border hover:border-beacon-amber/50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-beacon-amber/20 flex items-center justify-center flex-shrink-0">
                      <div className="w-6 h-6 rounded-full bg-beacon-amber" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-foreground">{contact.name}</h3>
                      <p className="text-sm text-muted-foreground">{contact.relationship}</p>
                      <p className="text-xs text-muted-foreground font-mono mt-2">{contact.phone}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 bg-card rounded-lg border border-border">
              <p className="text-muted-foreground mb-4">No trusted contacts yet</p>
              <Link
                href="/contacts"
                className="text-beacon-amber hover:underline font-semibold text-sm"
              >
                Add your first contact
              </Link>
            </div>
          )}
        </section>

        {/* Recent Sessions */}
        <section>
          <h2 className="text-2xl font-bold text-foreground mb-6">Recent sessions</h2>
          {recentSessions.length > 0 ? (
            <div className="space-y-4">
              {recentSessions.map((session) => (
                <Link
                  key={session.id}
                  href={`/session/active/${session.id}`}
                  className="block p-4 bg-card rounded-lg border border-border hover:border-beacon-amber/50 transition-all hover:shadow-md"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold text-foreground mb-2">{session.name}</h3>
                      <p className="text-sm text-muted-foreground mb-3">{session.checkpoints.length} checkpoints</p>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={session.status} />
                        <span className="text-xs text-muted-foreground">
                          {new Date(session.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="text-muted-foreground" size={20} />
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 bg-card rounded-lg border border-border">
              <MapPin className="mx-auto mb-4 text-muted-foreground" size={32} />
              <p className="text-muted-foreground mb-4">No sessions yet</p>
              <Link
                href="/session/new"
                className="text-beacon-amber hover:underline font-semibold text-sm"
              >
                Create your first session
              </Link>
            </div>
          )}
        </section>
      </div>

      <SOSButton
        onTrigger={() => {
          console.log('[v0] SOS button triggered')
        }}
      />
    </div>
  )
}
