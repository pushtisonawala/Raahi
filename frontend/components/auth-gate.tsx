'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { LoaderCircle } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  const isLoginPage = pathname === '/login'
  const redirectTo = !loading
    ? token && isLoginPage
      ? '/'
      : !token && !isLoginPage
        ? '/login'
        : null
    : null

  useEffect(() => {
    if (redirectTo) router.replace(redirectTo)
  }, [redirectTo, router])

  if (loading || redirectTo) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" role="status">
        <LoaderCircle className="animate-spin text-beacon-amber" size={28} />
        <span className="sr-only">Loading</span>
      </div>
    )
  }

  return children
}
