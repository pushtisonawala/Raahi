import { useState, useCallback, useEffect } from 'react'
import type { Contact, Session, Checkpoint } from './types'
import { ApiError, apiFetch } from './api'
import { useAuth } from './auth-context'

const STORAGE_KEY = 'raahi_app_state'

export function useContacts() {
  const { token, loading: authLoading, logout } = useAuth()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const handleError = useCallback(
    (cause: unknown) => {
      if (cause instanceof ApiError && cause.status === 401) logout()
      const message = cause instanceof Error ? cause.message : 'Unable to reach the server.'
      setError(message)
      return cause instanceof Error ? cause : new Error(message)
    },
    [logout]
  )

  const loadContacts = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) {
        setContacts([])
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)
      try {
        const response = await apiFetch('/contacts', { signal }, token)
        setContacts((await response.json()) as Contact[])
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        handleError(cause)
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [handleError, token]
  )

  useEffect(() => {
    if (authLoading) return
    const controller = new AbortController()
    void loadContacts(controller.signal)
    return () => controller.abort()
  }, [authLoading, loadContacts])

  const addContact = useCallback(
    async (contact: Omit<Contact, 'id'>) => {
      if (!token) throw new Error('You must be signed in to add a contact.')
      setError(null)
      try {
        const response = await apiFetch(
          '/contacts',
          { method: 'POST', body: JSON.stringify(contact) },
          token
        )
        const data = (await response.json()) as { id: string }
        const newContact = { ...contact, id: data.id }
        setContacts((current) => [newContact, ...current])
        return newContact
      } catch (cause) {
        throw handleError(cause)
      }
    },
    [handleError, token]
  )

  const updateContact = useCallback(
    async (id: string, updates: Partial<Contact>) => {
      if (!token) throw new Error('You must be signed in to update a contact.')
      const existing = contacts.find((contact) => contact.id === id)
      if (!existing) throw new Error('Contact not found.')
      const updated = { ...existing, ...updates, id }
      setError(null)
      try {
        await apiFetch(
          `/contacts/${encodeURIComponent(id)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              name: updated.name,
              phone: updated.phone,
              relationship: updated.relationship,
            }),
          },
          token
        )
        setContacts((current) =>
          current.map((contact) => (contact.id === id ? updated : contact))
        )
      } catch (cause) {
        throw handleError(cause)
      }
    },
    [contacts, handleError, token]
  )

  const deleteContact = useCallback(
    async (id: string) => {
      if (!token) throw new Error('You must be signed in to delete a contact.')
      setError(null)
      try {
        await apiFetch(`/contacts/${encodeURIComponent(id)}`, { method: 'DELETE' }, token)
        setContacts((current) => current.filter((contact) => contact.id !== id))
      } catch (cause) {
        throw handleError(cause)
      }
    },
    [handleError, token]
  )

  return {
    contacts,
    addContact,
    updateContact,
    deleteContact,
    loading: authLoading || loading,
    error,
    refresh: loadContacts,
    mounted: !authLoading && !loading,
  }
}

/* Session persistence remains local until the backend exposes session endpoints. */
export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const state = JSON.parse(stored)
      setSessions(state.sessions || [])
    }
    setMounted(true)
  }, [])

  const updateSessions = useCallback((newSessions: Session[]) => {
    setSessions(newSessions)
    const stored = localStorage.getItem(STORAGE_KEY)
    const state = stored ? JSON.parse(stored) : {}
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, sessions: newSessions }))
  }, [])

  const createSession = useCallback(
    (session: Omit<Session, 'id' | 'createdAt'>) => {
      const newSession: Session = {
        ...session,
        id: Date.now().toString(),
        createdAt: Date.now(),
      }
      updateSessions([...sessions, newSession])
      return newSession
    },
    [sessions, updateSessions]
  )

  const updateSession = useCallback(
    (id: string, updates: Partial<Session>) => {
      const updated = sessions.map((s) => (s.id === id ? { ...s, ...updates } : s))
      updateSessions(updated)
    },
    [sessions, updateSessions]
  )

  const getSession = useCallback(
    (id: string) => {
      return sessions.find((s) => s.id === id)
    },
    [sessions]
  )

  return {
    sessions,
    createSession,
    updateSession,
    getSession,
    mounted,
  }
}

export function useCheckpoints(sessionId: string | undefined) {
  const { sessions, updateSession } = useSessions()

  const session = sessionId ? sessions.find((s) => s.id === sessionId) : undefined

  const updateCheckpoint = useCallback(
    (checkpointId: string, updates: Partial<Checkpoint>) => {
      if (!session) return

      const updated = session.checkpoints.map((c) =>
        c.id === checkpointId ? { ...c, ...updates } : c
      )
      updateSession(session.id, { checkpoints: updated })
    },
    [session, updateSession]
  )

  const markCheckpointReached = useCallback(
    (checkpointId: string) => {
      updateCheckpoint(checkpointId, { status: 'reached' })
    },
    [updateCheckpoint]
  )

  return {
    checkpoints: session?.checkpoints || [],
    updateCheckpoint,
    markCheckpointReached,
  }
}

export function useActiveSession() {
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(undefined)
  const { sessions } = useSessions()

  const activeSession = activeSessionId ? sessions.find((s) => s.id === activeSessionId) : undefined

  return {
    activeSessionId,
    setActiveSessionId,
    activeSession,
  }
}
