import axios from 'axios'

/** Base URL of the Rejox backend. Overridable via VITE_API_URL per environment. */
export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

/**
 * Shared Axios client for talking to the Rejox backend.
 */
export const api = axios.create({
  baseURL: API_BASE,
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
