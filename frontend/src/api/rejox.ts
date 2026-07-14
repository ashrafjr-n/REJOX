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
