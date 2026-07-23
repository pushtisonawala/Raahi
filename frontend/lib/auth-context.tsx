'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { apiFetch } from './api'

const TOKEN_KEY = 'raahi_auth_token'

type AuthContextValue = {
  token: string | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_KEY))
    setLoading(false)
  }, [])

  const storeToken = useCallback((nextToken: string) => {
    localStorage.setItem(TOKEN_KEY, nextToken)
    setToken(nextToken)
  }, [])

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await apiFetch('/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
      const data = (await response.json()) as { token?: string }
      if (!data.token) throw new Error('The server did not return an authentication token.')
      storeToken(data.token)
    },
    [storeToken]
  )

  const signup = useCallback(
    async (email: string, password: string) => {
      const normalizedEmail = email.trim().toLowerCase()
      await apiFetch('/signup', {
        method: 'POST',
        body: JSON.stringify({ email: normalizedEmail, password }),
      })
      await login(normalizedEmail, password)
    },
    [login]
  )

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
  }, [])

  const value = useMemo(
    () => ({ token, loading, login, signup, logout }),
    [token, loading, login, signup, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
