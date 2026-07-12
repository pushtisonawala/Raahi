import { useState, useCallback, useEffect } from 'react'
import type { Contact, Session, Checkpoint } from './types'

const STORAGE_KEY = 'raahi_app_state'

// Mock data
const DEFAULT_CONTACTS: Contact[] = [
  {
    id: '1',
    name: 'Alex Chen',
    phone: '+1 (555) 123-4567',
    relationship: 'Sister',
  },
  {
    id: '2',
    name: 'Jordan Martinez',
    phone: '+1 (555) 987-6543',
    relationship: 'Best Friend',
  },
  {
    id: '3',
    name: 'Sam Patel',
    phone: '+1 (555) 456-7890',
    relationship: 'Parent',
  },
]

export function useContacts() {
  const [contacts, setContacts] = useState<Contact[]>(DEFAULT_CONTACTS)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const state = JSON.parse(stored)
      setContacts(state.contacts || DEFAULT_CONTACTS)
    }
    setMounted(true)
  }, [])

  const updateContacts = useCallback((newContacts: Contact[]) => {
    setContacts(newContacts)
    const stored = localStorage.getItem(STORAGE_KEY)
    const state = stored ? JSON.parse(stored) : {}
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, contacts: newContacts }))
  }, [])

  const addContact = useCallback(
    (contact: Omit<Contact, 'id'>) => {
      const newContact: Contact = {
        ...contact,
        id: Date.now().toString(),
      }
      updateContacts([...contacts, newContact])
      return newContact
    },
    [contacts, updateContacts]
  )

  const updateContact = useCallback(
    (id: string, updates: Partial<Contact>) => {
      const updated = contacts.map((c) => (c.id === id ? { ...c, ...updates } : c))
      updateContacts(updated)
    },
    [contacts, updateContacts]
  )

  const deleteContact = useCallback(
    (id: string) => {
      updateContacts(contacts.filter((c) => c.id !== id))
    },
    [contacts, updateContacts]
  )

  return {
    contacts,
    addContact,
    updateContact,
    deleteContact,
    mounted,
  }
}

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
