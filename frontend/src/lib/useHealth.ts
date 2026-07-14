import { useEffect, useState } from 'react'

import { api } from './api'
import type { HealthResponse } from '../types/api'

/**
 * Honest backend liveness. Polls GET /health and reports one of three states —
 * never asserts readiness it hasn't verified:
 *   - checking     : first probe in flight (or backend not yet answered)
 *   - ready        : /health returned {status: "ok"}
 *   - unreachable  : the request failed, or returned a non-ok status
 */
export type HealthStatus = 'checking' | 'ready' | 'unreachable'

export function useHealth(intervalMs = 5000): HealthStatus {
  const [status, setStatus] = useState<HealthStatus>('checking')

  useEffect(() => {
    let cancelled = false

    const probe = async () => {
      try {
        const { data } = await api.get<HealthResponse>('/health', {
          timeout: 4000,
        })
        if (!cancelled) setStatus(data.status === 'ok' ? 'ready' : 'unreachable')
      } catch {
        if (!cancelled) setStatus('unreachable')
      }
    }

    void probe()
    const timer = setInterval(() => void probe(), intervalMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [intervalMs])

  return status
}
