import { useEffect, useState } from 'react'

import { ApiError, analyze } from '../api/rejox'
import { Button } from '../components/ui/Button'
import { AlertIcon } from '../components/icons'
import { usePipelineStore } from '../store/pipelineStore'
import type { SourceRequest } from '../types/api'

/**
 * `/api/analyze` is a single blocking call — the backend gives us no per-stage
 * progress, so the UI must not pretend to know one. We show one honest
 * indeterminate state plus an elapsed-time counter, and list the passes the
 * engine performs as *static* text. Nothing is marked complete until the
 * backend actually returns the report (which advances us to the Report stage).
 */
const PASSES = [
  { label: 'Parsing source', detail: 'JSX / TSX → AST via the parser worker' },
  { label: 'Building the knowledge graph', detail: 'components · routes · stores · endpoints' },
  { label: 'Detecting libraries', detail: 'mapping dependencies to RN equivalents' },
  { label: 'Scoring migratability', detail: 'Coverage · Confidence · Risk' },
] as const

export function AnalyzingScreen() {
  const ingest = usePipelineStore((s) => s.ingest)
  const selectedRoot = usePipelineStore((s) => s.selectedRoot)
  const completeAnalysis = usePipelineStore((s) => s.completeAnalysis)
  const reset = usePipelineStore((s) => s.reset)

  const [elapsedMs, setElapsedMs] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ingest) {
      reset()
      return
    }

    // Abort the request if this effect tears down (incl. StrictMode's throwaway
    // mount in dev) so only the committed mount's analysis drives the UI.
    let cancelled = false
    const controller = new AbortController()
    const startedAt = performance.now()
    const ticker = setInterval(() => {
      if (!cancelled) setElapsedMs(performance.now() - startedAt)
    }, 100)

    const source: SourceRequest = selectedRoot
      ? { runId: ingest.runId, root: selectedRoot }
      : { runId: ingest.runId }

    analyze(source, controller.signal)
      .then((report) => {
        if (!cancelled) completeAnalysis(report)
      })
      .catch((err: unknown) => {
        // A cancelled (aborted) request is expected on teardown — ignore it.
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Analysis failed.')
        }
      })

    return () => {
      cancelled = true
      clearInterval(ticker)
      controller.abort()
    }
  }, [ingest, selectedRoot, completeAnalysis, reset])

  if (error) {
    return (
      <div className="mx-auto max-w-lg pt-10">
        <div className="rounded-xl border border-danger/30 bg-danger/8 p-6 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-danger/15 text-danger">
            <AlertIcon className="text-[20px]" />
          </span>
          <h2 className="mt-4 text-[15px] font-semibold text-ink">
            The engine hit a wall
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-ink-2">
            {error}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="secondary" onClick={reset}>
              Back to upload
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl pt-6" data-testid="analyzing-screen">
      <header className="mb-8 text-center">
        <div className="eyebrow mb-3">Stage 02 · Intelligence</div>
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">
          Analyzing project…
        </h1>
        <p className="mt-2 text-[13.5px] text-ink-3">
          Deterministic passes over your source — no code is changed here.
        </p>
      </header>

      {/* Honest, indeterminate indicator + elapsed time. No fake per-stage
          completion: the backend reports nothing until the report is ready. */}
      <div className="flex flex-col items-center rounded-xl border border-line bg-surface-1 px-6 py-8 shadow-[var(--shadow-panel)]">
        <span
          className="h-9 w-9 animate-spin rounded-full border-[3px] border-signal/20 border-t-signal"
          role="progressbar"
          aria-label="Analyzing"
        />
        <div className="mt-5 flex items-baseline gap-2">
          <span className="tnum font-mono text-[26px] font-semibold text-ink tabular-nums">
            {(elapsedMs / 1000).toFixed(1)}
          </span>
          <span className="text-[13px] text-ink-4">s elapsed</span>
        </div>
        <p className="mt-1 font-mono text-[11px] tracking-wide text-ink-3">
          running · waiting on the engine
        </p>
      </div>

      {/* What this pass performs — static reference, NOT a progress tracker.
          No spinners, no checkmarks, no timed advancement. */}
      <div className="mt-5">
        <div className="eyebrow mb-2.5 text-center">What this pass performs</div>
        <ul className="overflow-hidden rounded-xl border border-line bg-surface-0">
          {PASSES.map((pass, i) => (
            <li
              key={pass.label}
              className="flex items-center gap-4 border-b border-line/60 px-4 py-3 last:border-0"
            >
              <span className="font-mono text-[10px] tracking-widest text-ink-4 tabular-nums">
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium text-ink-2">
                  {pass.label}
                </div>
                <div className="font-mono text-[11px] text-ink-4">
                  {pass.detail}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
