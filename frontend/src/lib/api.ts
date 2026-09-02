import axios from 'axios'

/**
 * Same-origin by default: the dev server and the production reverse proxy both
 * serve the API under /api on the origin the app itself is served from, so the
 * SameSite=Lax session cookie is sent with every request. Setting VITE_API_URL
 * to a different origin opts out of that and the cookie will NOT be sent —
 * only useful for an API-key client.
 */
export const API_BASE = import.meta.env.VITE_API_URL ?? ''

/**
 * Shared Axios client for talking to the Rejox backend.
 *
 * `withCredentials` so the session cookie rides along. It is httpOnly, so no
 * code here can read it — signing in and out happens entirely through
 * /api/session, and the browser holds the credential where scripts cannot.
 */
export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
})

/** Absolute URL of the SSE event stream for a migration job. */
export function jobEventsUrl(jobId: string, lastEventId?: number): string {
  const base = `${API_BASE}/api/jobs/${jobId}/events`
  return lastEventId && lastEventId > 0 ? `${base}?lastEventId=${lastEventId}` : base
}

/** Absolute URL of the emitted React Native project download (ZIP). */
export function downloadUrl(runId: string): string {
  return `${API_BASE}/api/runs/${runId}/download`
}
