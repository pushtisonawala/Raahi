'use client'

import { useCallback, useEffect, useState } from 'react'
import { API_URL, apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'

export type SessionCheckpointStatus =
  | 'pending'
  | 'reached'
  | 'overdue'
  | 'pinged'
  | 'contacts_alerted'

export type SessionCheckpoint = {
  id: string
  name: string
  status: SessionCheckpointStatus
  expected_time: string | null
  lat: number | null
  lng: number | null
  radius_meters: number
  order_index: number
}

export type SessionData = {
  id: string
  user_id: string
  name: string
  route: string
  status: 'active' | 'completed' | 'escalated' | 'sos_triggered'
  grace_period: number
  started_at: string
  completed_at: string | null
  checkpoints: SessionCheckpoint[]
}

const WS_URL = API_URL.replace(/^http/, 'ws')

export function useSessionData(sessionId: string | undefined) {
  const { token, loading: authLoading } = useAuth()
  const [session, setSession] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadSession = useCallback(
    async (signal?: AbortSignal, showLoading = false) => {
      if (!sessionId || !token) {
        setSession(null)
        setLoading(false)
        return
      }

      if (showLoading) setLoading(true)
      try {
        const response = await apiFetch(
          `/sessions/${encodeURIComponent(sessionId)}`,
          { signal },
          token
        )
        setSession((await response.json()) as SessionData)
        setError(null)
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setError(cause instanceof Error ? cause.message : 'Unable to load the session.')
        setSession(null)
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [sessionId, token]
  )

  useEffect(() => {
    if (authLoading) return

    const controller = new AbortController()
    void loadSession(controller.signal, true)
    return () => controller.abort()
  }, [authLoading, loadSession])

  useEffect(() => {
    if (!sessionId || !token) return

    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let disposed = false

    const connect = () => {
      socket = new WebSocket(`${WS_URL}/sessions/${encodeURIComponent(sessionId)}/ws`)
      socket.onmessage = () => void loadSession()
      socket.onclose = () => {
        if (!disposed) reconnectTimer = setTimeout(connect, 3000)
      }
    }

    connect()

    return () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [loadSession, sessionId, token])

  return { session, loading: authLoading || loading, error, refresh: loadSession }
}
