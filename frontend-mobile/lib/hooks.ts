// Unchanged logic from the web app's lib/hooks.ts - same REST calls, same
// error handling. Framework-agnostic, so it ports over verbatim.
import { useState, useCallback, useEffect } from 'react'
import type { Contact } from './types'
import type { SessionData } from './hooks/useSessionData'
import { ApiError, apiFetch } from './api'
import { useAuth } from './auth-context'

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
              email: updated.email,
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

export function useSessions() {
  const { token, loading: authLoading, logout } = useAuth()
  const [sessions, setSessions] = useState<SessionData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadSessions = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) {
        setSessions([])
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)
      try {
        const response = await apiFetch('/sessions', { signal }, token)
        setSessions((await response.json()) as SessionData[])
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        if (cause instanceof ApiError && cause.status === 401) logout()
        setError(cause instanceof Error ? cause.message : 'Unable to load sessions.')
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [logout, token]
  )

  useEffect(() => {
    if (authLoading) return
    const controller = new AbortController()
    void loadSessions(controller.signal)
    return () => controller.abort()
  }, [authLoading, loadSessions])

  return {
    sessions,
    loading: authLoading || loading,
    error,
    refresh: loadSessions,
  }
}
