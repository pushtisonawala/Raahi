// Same backend contract as the web app's lib/api.ts. Only the env var prefix
// changed (NEXT_PUBLIC_ -> EXPO_PUBLIC_, which is Expo's convention for
// exposing env vars to client code).
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080'

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function apiFetch(path: string, init: RequestInit = {}, token?: string | null) {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${API_URL}${path}`, { ...init, headers })
  if (!response.ok) {
    const detail = (await response.text()).trim()
    throw new ApiError(detail || 'The request could not be completed.', response.status)
  }
  return response
}
