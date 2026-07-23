'use client'

import { useState } from 'react'
import { LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

type Mode = 'login' | 'signup'

export default function LoginPage() {
  const { login, signup } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      if (mode === 'login') await login(email, password)
      else await signup(email, password)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to continue. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const changeMode = (nextMode: Mode) => {
    setMode(nextMode)
    setError(null)
  }

  return (
    <main className="min-h-screen bg-dawn-mist px-4 py-10 flex items-center justify-center sm:px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-beacon-amber text-ink-indigo">
            <ShieldCheck size={28} aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">Raahi</h1>
          <p className="mt-2 text-muted-foreground">Your safety circle, wherever you go.</p>
        </div>

        <div className="rounded-lg border border-border bg-background p-6 shadow-sm sm:p-8">
          <div className="mb-6 grid grid-cols-2 rounded-lg bg-muted p-1" aria-label="Account action">
            {(['login', 'signup'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => changeMode(item)}
                className={`rounded-md px-3 py-2 text-sm font-semibold ${
                  mode === item ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                {item === 'login' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="mb-2 block text-sm font-medium text-foreground">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-lg border border-border bg-input px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-beacon-amber"
                placeholder="you@example.com"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-2 block text-sm font-medium text-foreground">Password</label>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} aria-hidden="true" />
                <input
                  id="password"
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  className="w-full rounded-lg border border-border bg-input py-3 pl-10 pr-4 text-foreground focus:outline-none focus:ring-2 focus:ring-beacon-amber"
                  placeholder="At least 8 characters"
                  required
                />
              </div>
            </div>

            {error && (
              <p className="rounded-md border border-alert-coral/30 bg-alert-coral/10 px-3 py-2 text-sm text-alert-coral" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-beacon-amber px-4 py-3 font-semibold text-ink-indigo hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting && <LoaderCircle className="animate-spin" size={18} aria-hidden="true" />}
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}
