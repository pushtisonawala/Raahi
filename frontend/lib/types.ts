export interface Contact {
  id: string
  name: string
  phone: string
  relationship: string
}

export interface Checkpoint {
  id: string
  name: string
  expectedTime: number // in minutes
  location: {
    lat: number
    lng: number
  }
  status: 'pending' | 'reached' | 'overdue'
}

export interface Session {
  id: string
  name: string
  route: string
  checkpoints: Checkpoint[]
  contacts: string[] // array of contact IDs
  status: 'active' | 'completed' | 'escalated'
  gracePeriod: number // in minutes
  startTime: number // timestamp
  endTime?: number // timestamp
  createdAt: number // timestamp
  lastKnownLocation?: {
    lat: number
    lng: number
  }
}

export interface AppState {
  contacts: Contact[]
  sessions: Session[]
  activeSessionId?: string
}
