import { motion, useReducedMotion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'

import { ApiError, analyze, plan as fetchPlan } from '../api/rejox'
import { StepHeader } from '../components/StepHeader'
import { Button } from '../components/ui/Button'
import { AlertIcon, CheckIcon, CircuitIcon } from '../components/icons'
import { cn } from '../lib/cn'
import { formatScore } from '../lib/display'
import { DUR, HOUSE_EASE } from '../lib/motion'
import { usePipelineStore } from '../store/pipelineStore'
import type { AnalysisReport, SourceRequest } from '../types/api'

/**
 * `/api/analyze` is a single blocking call — the backend gives us no per-stage
 * progress, so the UI must not pretend to know one.
 *
 * Two phases, and the difference between them is the whole point:
 *
 *  1. **Waiting** — the request is genuinely in flight. One honest indeterminate
 *     spinner plus an elapsed counter. Nothing is claimed to be finished.
 *  2. **Reveal** — the response has *already landed*. Every line below is read
 *     straight out of that response; the stagger is presentation, not progress,
 *     so nothing on screen says "analyzing" once we are here. The elapsed time
 *     freezes at what the engine actually took.
 *
 * The sequence ends on a Ready line and then hands off to the Migration Report.
 * Under `prefers-reduced-motion` every line is shown at once (no stagger).
 */

/** Delay between revealed lines. Presentation only — the data is already here. */
const STEP_MS = 360
/** Beat the Ready line holds before the Report takes over. */
const READY_HOLD_MS = 1100

type FindingTone = 'fact' | 'transitional' | 'flag' | 'ready'

interface Finding {
  id: string
  label: string
  detail: string
  tone: FindingTone
}

/**
 * Turn the real `AnalysisReport` into the lines we narrate. Every value here is
 * a field the response actually carries (or a count derived from one) — nothing
 * is invented, and a line is omitted when the report has nothing to say.
 */
function buildFindings(report: AnalysisReport): Finding[] {
  const s = report.summary
  const libraries = report.libraries ?? []
  const unsupported = libraries.filter((l) => l.status === 'unsupported')
  const needsWork = libraries.filter(
    (l) => l.status === 'needs-conversion' || l.status === 'partial',
  )
  const warnings = report.warnings ?? []
  const blockers = report.blockers ?? []

  const findings: Finding[] = [
    {
      id: 'project',
      label: `Parsed ${report.projectName}`,
      detail: `${libraries.length} ${libraries.length === 1 ? 'dependency' : 'dependencies'} scanned`,
      tone: 'fact',
    },
    {
      id: 'components',
      label: `${s.componentCount} components`,
      detail: `${s.pageCount} ${s.pageCount === 1 ? 'page' : 'pages'}`,
      tone: 'fact',
    },
    {
      id: 'routing',
      label: report.routing.library
        ? `${s.routeCount} routes · ${report.routing.library}`
        : `${s.routeCount} routes · no router detected`,
      detail: report.routing.hasParams
        ? 'parameterised routes present'
        : 'no route params',
      tone: 'fact',
    },
    {
      id: 'graph',
      // The transitional beat between the raw counts and the notable findings.
      // Past tense: by the time any of this is on screen the graph exists.
      label: 'Knowledge graph built',
      detail: `${s.apiEndpointCount} API endpoints · ${s.storeCount} ${s.storeCount === 1 ? 'store' : 'stores'}`,
      tone: 'transitional',
    },
  ]

  if (unsupported.length > 0) {
    findings.push({
      id: 'unsupported',
      label: `${unsupported.length} unsupported ${unsupported.length === 1 ? 'library' : 'libraries'}`,
      detail: unsupported.map((l) => l.name).join(' · '),
      tone: 'flag',
    })
  } else if (needsWork.length > 0) {
    findings.push({
      id: 'libraries',
      label: `${needsWork.length} libraries need conversion`,
      detail: needsWork.map((l) => l.name).join(' · '),
      tone: 'flag',
    })
  }

  if (warnings.length > 0 || blockers.length > 0) {
    findings.push({
      id: 'issues',
      label:
        blockers.length > 0
          ? `${blockers.length} ${blockers.length === 1 ? 'blocker' : 'blockers'} · ${warnings.length} warnings`
          : `${warnings.length} ${warnings.length === 1 ? 'warning' : 'warnings'}`,
      detail: blockers.length > 0 ? 'blocking issues found' : 'no blockers',
      tone: 'flag',
    })
  }

  findings.push({
    id: 'ready',
    label: 'Ready',
    detail: `Coverage ${formatScore(report.coverage)} · Confidence ${formatScore(report.confidence)}`,
    tone: 'ready',
  })

  return findings
}

export function AnalyzingScreen() {
  const ingest = usePipelineStore((s) => s.ingest)
  const selectedRoot = usePipelineStore((s) => s.selectedRoot)
  const completeAnalysis = usePipelineStore((s) => s.completeAnalysis)
  const setPlan = usePipelineStore((s) => s.setPlan)
  const beginPlanPrefetch = usePipelineStore((s) => s.beginPlanPrefetch)
  const failPlanPrefetch = usePipelineStore((s) => s.failPlanPrefetch)
  const reset = usePipelineStore((s) => s.reset)
  const reduceMotion = useReducedMotion()

  const [elapsedMs, setElapsedMs] = useState(0)
  const [error, setError] = useState<string | null>(null)
  /** The landed response. Non-null ⇒ the engine is done; nothing is in flight. */
  const [report, setReport] = useState<AnalysisReport | null>(null)
  /** How much of the (already-known) result has been revealed so far. */
  const [revealed, setRevealed] = useState(0)

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
      .then((landed) => {
        if (cancelled) return
        // Freeze the counter at what the call really took, then hand over to
        // the reveal — from here on nothing is in flight.
        clearInterval(ticker)
        setElapsedMs(performance.now() - startedAt)
        setReport(landed)

        // Prefetch the plan behind the reveal. It costs one more request but
        // the reveal covers it, and it is what lets the Review checklist state
        // the real number of pending decisions on the *first* visit instead of
        // discovering them a screen later. Failure is silent here: the Plan
        // screen re-requests and reports errors properly.
        beginPlanPrefetch()
        fetchPlan(source, controller.signal)
          .then((res) => {
            if (!cancelled) setPlan(res.plan)
          })
          .catch(() => {
            if (!cancelled) failPlanPrefetch()
          })
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
  }, [
    ingest,
    selectedRoot,
    reset,
    beginPlanPrefetch,
    failPlanPrefetch,
    setPlan,
  ])

  const findings = useMemo(
    () => (report ? buildFindings(report) : []),
    [report],
  )

  // The reveal. It only ever runs on data we already hold, so the timing is
  // pacing, never a stand-in for work. Reduced motion skips straight to the
  // full list and only keeps the hand-off beat.
  useEffect(() => {
    if (!report || findings.length === 0) return

    // One duration for both paths: reduced motion drops the stagger, not the
    // time to read the list.
    const totalMs = (findings.length - 1) * STEP_MS + READY_HOLD_MS
    const timers: number[] = []

    if (reduceMotion) {
      setRevealed(findings.length)
    } else {
      for (let i = 1; i <= findings.length; i += 1) {
        timers.push(window.setTimeout(() => setRevealed(i), (i - 1) * STEP_MS))
      }
    }
    timers.push(window.setTimeout(() => completeAnalysis(report), totalMs))

    return () => timers.forEach(clearTimeout)
  }, [report, findings, reduceMotion, completeAnalysis])

  if (error) {
    return (
      <div className="mx-auto max-w-lg pt-10">
        <div className="rounded-xl border border-danger/30 bg-danger/8 p-6 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-danger/15 text-danger">
            <AlertIcon className="text-[20px]" />
          </span>
          <h2 className="mt-4 text-[16px] font-semibold text-ink">
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

  const landed = report !== null

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="analyzing-screen">
      <StepHeader
        stage="analyzing"
        title={landed ? 'What the engine found' : 'Analyzing project…'}
        description={
          landed
            ? 'Read straight from the analysis. No code has been changed.'
            : 'Deterministic passes over your source — no code is changed here.'
        }
      />

      {landed ? (
        <FindingsList
          findings={findings}
          revealed={revealed}
          elapsedMs={elapsedMs}
          reduceMotion={reduceMotion === true}
        />
      ) : (
        /* Honest, indeterminate indicator + elapsed time, shown only while the
           request is genuinely in flight. No fake per-stage completion. */
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
          <p className="mt-1 font-mono text-[11.5px] tracking-wide text-ink-3">
            running · waiting on the engine
          </p>
        </div>
      )}
    </div>
  )
}

const MARKER_CLASS: Record<FindingTone, string> = {
  fact: 'border-signal/40 bg-signal/10 text-signal',
  transitional: 'border-line-strong bg-surface-2 text-ink-3',
  flag: 'border-warn/40 bg-warn/10 text-warn',
  ready: 'border-pos/40 bg-pos/15 text-pos',
}

function FindingsList({
  findings,
  revealed,
  elapsedMs,
  reduceMotion,
}: {
  findings: Finding[]
  revealed: number
  elapsedMs: number
  reduceMotion: boolean
}) {
  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between">
        <div className="eyebrow">Findings</div>
        {/* Past tense on purpose: this is what the call took, not a live clock. */}
        <span className="font-mono text-[11.5px] tracking-wide text-ink-4">
          engine returned in {(elapsedMs / 1000).toFixed(1)}s
        </span>
      </div>
      <ul
        className="overflow-hidden rounded-xl border border-line bg-surface-0"
        role="status"
        aria-live="polite"
      >
        {findings.slice(0, revealed).map((f) => (
          <motion.li
            key={f.id}
            data-testid="finding-row"
            data-tone={f.tone}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DUR.enter, ease: HOUSE_EASE }}
            className="flex items-center gap-4 border-b border-line/60 px-4 py-3 last:border-0"
          >
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border',
                MARKER_CLASS[f.tone],
              )}
            >
              {f.tone === 'ready' ? (
                <CheckIcon className="text-[16px]" />
              ) : f.tone === 'transitional' ? (
                <CircuitIcon className="text-[16px]" />
              ) : f.tone === 'flag' ? (
                <AlertIcon className="text-[15px]" />
              ) : (
                <CheckIcon className="text-[16px]" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  'text-[15px] font-medium',
                  f.tone === 'ready' ? 'text-ink' : 'text-ink-2',
                )}
              >
                {f.label}
              </div>
              <div className="font-mono text-[11.5px] text-ink-4">{f.detail}</div>
            </div>
          </motion.li>
        ))}
      </ul>
    </div>
  )
}
