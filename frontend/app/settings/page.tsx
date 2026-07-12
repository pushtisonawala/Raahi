'use client'

import { useState, useEffect } from 'react'
import { Header } from '@/components/header'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'

export default function SettingsPage() {
  const [gracePeriod, setGracePeriod] = useState(5)
  const [liveShare, setLiveShare] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('raahi_settings')
    if (stored) {
      const settings = JSON.parse(stored)
      setGracePeriod(settings.gracePeriod || 5)
      setLiveShare(settings.liveShare || false)
    }
    setMounted(true)
  }, [])

  const handleSaveSettings = () => {
    const settings = { gracePeriod, liveShare }
    localStorage.setItem('raahi_settings', JSON.stringify(settings))
  }

  useEffect(() => {
    if (mounted) {
      handleSaveSettings()
    }
  }, [gracePeriod, liveShare, mounted])

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

      <div className="max-w-2xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Settings</h1>
          <p className="text-muted-foreground">Customize your safety experience</p>
        </div>

        {/* Settings Sections */}
        <div className="space-y-8">
          {/* Grace Period */}
          <div className="p-6 bg-card rounded-lg border border-border">
            <h2 className="text-lg font-semibold text-foreground mb-4">Grace period</h2>
            <p className="text-sm text-muted-foreground mb-4">
              If you&apos;re late reaching a checkpoint, we&apos;ll wait this long before checking in with you. This gives you time to get back on track.
            </p>
            <div className="flex items-end gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-foreground mb-2">Minutes</label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={gracePeriod}
                  onChange={(e) => setGracePeriod(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-4 py-2 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-beacon-amber text-foreground"
                />
              </div>
              <span className="text-sm text-muted-foreground pb-2">
                {gracePeriod === 1 ? 'minute' : 'minutes'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-3 italic">
              Plain language: If you&apos;re {gracePeriod} minute{gracePeriod === 1 ? '' : 's'} late, we&apos;ll check on you before contacting anyone.
            </p>
          </div>

          {/* Live Share */}
          <div className="p-6 bg-card rounded-lg border border-border">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-foreground mb-4">Live location sharing</h2>
                <p className="text-sm text-muted-foreground">
                  Share your real-time location with trusted contacts during active sessions. They can follow your progress on a map.
                </p>
              </div>
              <button
                onClick={() => setLiveShare(!liveShare)}
                className={`ml-4 relative w-12 h-7 rounded-full transition-colors flex-shrink-0 ${
                  liveShare ? 'bg-safe-teal' : 'bg-muted'
                }`}
                aria-label="Toggle live sharing"
              >
                <span
                  className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full transition-transform ${
                    liveShare ? 'translate-x-5' : ''
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Contacts Link */}
          <div className="p-6 bg-card rounded-lg border border-border">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground mb-1">Manage trusted contacts</h2>
                <p className="text-sm text-muted-foreground">Add, edit, or remove people you trust</p>
              </div>
              <Link href="/contacts" className="text-beacon-amber hover:text-amber-500 transition-colors">
                <ArrowRight size={24} />
              </Link>
            </div>
          </div>

          {/* About */}
          <div className="p-6 bg-card rounded-lg border border-border">
            <h2 className="text-lg font-semibold text-foreground mb-4">About Raahi</h2>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                <strong>Version:</strong> 1.0.0
              </p>
              <p>
                <strong>Made with:</strong> Next.js, React, Tailwind CSS
              </p>
              <p>
                <strong>Design:</strong> Beacon Path design system
              </p>
              <p className="pt-2">
                Raahi helps you stay safe by keeping you connected with people who care. Your safety is our priority.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
