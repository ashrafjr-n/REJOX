/**
 * Typed API functions mirroring the backend routes in `backend/app/main.py`.
 * Every call returns a schema type from `types/api` and normalizes failures
 * into an `ApiError` carrying the backend's `detail` string verbatim.
 */
import axios from 'axios'

import { api } from '../lib/api'
import type {
  AnalysisReport,
  IngestedProject,
  JobCreated,
  JobState,
  PlanResponse,
  SessionState,
  SourceRequest,
  ValidationError,
} from '../types/api'

/** A normalized error surfaced to the UI — never a raw axios object. */
export class ApiError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Pull the human message out of a FastAPI/axios failure. */
function toApiError(err: unknown): ApiError {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status
    const detail = err.response?.data?.detail
    if (typeof detail === 'string') return new ApiError(detail, status)
    if (Array.isArray(detail)) {
      const msg = (detail as ValidationError[])
        .map((d) => d.msg)
        .filter(Boolean)
        .join('; ')
      return new ApiError(msg || 'Request validation failed.', status)
    }
    if (err.code === 'ERR_NETWORK') {
      return new ApiError(
        'Cannot reach the Rejox engine. Is the backend running on :8000?',
        status,
      )
    }
    return new ApiError(err.message, status)
  }
  return new ApiError(err instanceof Error ? err.message : 'Unexpected error.')
}

/** Upload stage — land a ZIP and detect the React root. */
export async function uploadZip(file: File): Promise<IngestedProject> {
  const form = new FormData()
  form.append('file', file)
  try {
    const { data } = await api.post<IngestedProject>('/api/upload', form)
    return data
  } catch (err) {
    throw toApiError(err)
  }
}

/** Upload stage — shallow-clone a public GitHub repo. */
export async function uploadGithub(
  url: string,
  ref?: string,
): Promise<IngestedProject> {
  const body = ref ? { url, ref } : { url }
  try {
    const { data } = await api.post<IngestedProject>('/api/upload/github', body)
    return data
  } catch (err) {
    throw toApiError(err)
  }
}

/** Analysis stage — parse + analyze migratability into an AnalysisReport. */
export async function analyze(
  source: SourceRequest,
  signal?: AbortSignal,
): Promise<AnalysisReport> {
  try {
    const { data } = await api.post<AnalysisReport>('/api/analyze', source, {
      signal,
    })
    return data
  } catch (err) {
    throw toApiError(err)
  }
}

/** Plan stage — parse + analyze + plan; returns the report and the plan (DAG + questions). */
export async function plan(
  source: SourceRequest,
  signal?: AbortSignal,
): Promise<PlanResponse> {
  try {
    const { data } = await api.post<PlanResponse>('/api/plan', source, { signal })
    return data
  } catch (err) {
    throw toApiError(err)
  }
}

/**
 * Migrate stage — start the background migration job with the Ask-stage answers.
 * Returns immediately (202) with the job id; the real endpoint from main.py.
 */
export async function startMigration(
  source: SourceRequest,
  answers: Record<string, string>,
): Promise<JobCreated> {
  const body = { ...source, answers, install: true, runBundle: true }
  try {
    const { data } = await api.post<JobCreated>('/api/migrate', body)
    return data
  } catch (err) {
    throw toApiError(err)
  }
}

/**
 * Job state — the reconstructable source of truth for a migration job (status,
 * every event so far, terminal result/error). Read on mount before/instead of
 * streaming, so a late joiner or reconnect loses nothing.
 */
export async function getJob(jobId: string): Promise<JobState> {
  try {
    const { data } = await api.get<JobState>(`/api/jobs/${jobId}`)
    return data
  } catch (err) {
    throw toApiError(err)
  }
}

// --- Session ------------------------------------------------------------------
//
// The cookie behind these is httpOnly, so nothing here ever holds or reads it.
// These three calls are the whole of the browser's relationship with it: ask
// whether we are signed in, sign in, sign out.

/** Whether this browser holds a valid session, and which account it names. */
export async function getSession(): Promise<SessionState> {
  try {
    const { data } = await api.get<SessionState>('/api/session')
    return data
  } catch (err) {
    throw toApiError(err)
  }
}

/** Exchange an invite code for a session cookie. */
export async function signIn(code: string): Promise<SessionState> {
  try {
    const { data } = await api.post<SessionState>('/api/session', { code })
    return data
  } catch (err) {
    throw toApiError(err)
  }
}

/** Drop the session cookie. Idempotent. */
export async function signOut(): Promise<void> {
  try {
    await api.delete('/api/session')
  } catch (err) {
    throw toApiError(err)
  }
}
