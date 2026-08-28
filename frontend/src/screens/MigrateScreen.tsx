import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { ApiError, getJob } from '../api/rejox'
import { downloadUrl, jobEventsUrl } from '../lib/api'
import { StepHeader } from '../components/StepHeader'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Panel } from '../components/ui/Panel'
import { AlertIcon, CheckIcon, FileZipIcon } from '../components/icons'
import { cn } from '../lib/cn'
import { formatScore, formatScorePercent } from '../lib/display'
import { usePipelineStore } from '../store/pipelineStore'
import type {
  AnalysisReport,
  JobStatus,
  MigrationError,
  MigrationEvent,
  MigrationResult,
  MigrationStage,
} from '../types/api'

// The real, ordered boundaries. `repair` is shown only if it actually ran;
// `done` is terminal (the result), not a row here.
const STAGE_ROWS: { stage: MigrationStage; label: string }[] = [
  { stage: 'emit', label: 'Emit React Native project' },
  { stage: 'install', label: 'npm install' },
  { stage: 'typecheck', label: 'Type-check (tsc)' },
  { stage: 'bundle', label: 'Bundle (Metro export)' },
]

type StageState = 'pending' | 'running' | 'done' | 'failed'

interface StageView {
  started?: MigrationEvent
  completed?: MigrationEvent
}

/**
 * Subscribe to a migration job's live event stream — the source of truth is
 * GET /api/jobs/{id} (reconstructed on mount), then SSE for anything new. Native
 * EventSource carries Last-Event-ID on reconnect, so a dropped stream resumes
 * without loss. Nothing is invented: state is only what the backend emitted.
 */
function useMigration(jobId: string | null) {
  const [events, setEvents] = useState<MigrationEvent[]>([])
  const [status, setStatus] = useState<JobStatus>('queued')
  const [result, setResult] = useState<MigrationResult | null>(null)
  const [error, setError] = useState<MigrationError | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const seen = useRef<Set<number>>(new Set())

  const ingest = useCallback((ev: MigrationEvent) => {
    if (seen.current.has(ev.seq)) return
    seen.current.add(ev.seq)
    setEvents((prev) => [...prev, ev].sort((a, b) => a.seq - b.seq))
    if (ev.type === 'succeeded') {
      setStatus('succeeded')
      if (ev.result) setResult(ev.result)
    } else if (ev.type === 'failed') {
      setStatus('failed')
      if (ev.error) setError(ev.error)
    }
  }, [])

  useEffect(() => {
    if (!jobId) return
    let cancelled = false
    let es: EventSource | null = null

    const start = async () => {
      // 1. Reconstruct from the source of truth.
      let maxSeq = 0
      try {
        const job = await getJob(jobId)
        if (cancelled) return
        setStatus(job.status)
        for (const ev of job.events ?? []) {
          ingest(ev)
          maxSeq = Math.max(maxSeq, ev.seq)
        }
        if (job.result) setResult(job.result)
        if (job.error) setError(job.error)
        if (job.status === 'succeeded' || job.status === 'failed') return // terminal — no stream
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof ApiError ? err.message : 'Could not load the job.')
        }
        return
      }

      // 2. Stream anything new. Events are named (event: <type>), so listen per type.
      es = new EventSource(jobEventsUrl(jobId, maxSeq))
      const onEvent = (e: MessageEvent) => {
        try {
          const ev = JSON.parse(e.data) as MigrationEvent
          ingest(ev)
          if (ev.type === 'succeeded' || ev.type === 'failed') es?.close()
        } catch {
          /* ignore a malformed frame */
        }
      }
      for (const t of ['stage_started', 'stage_completed', 'succeeded', 'failed']) {
        es.addEventListener(t, onEvent)
      }
    }

    void start()
    return () => {
      cancelled = true
      es?.close()
    }
  }, [jobId, ingest])

  return { events, status, result, error, loadError }
}

export function MigrateScreen() {
  const jobId = usePipelineStore((s) => s.jobId)
  const report = usePipelineStore((s) => s.report)
  const reset = usePipelineStore((s) => s.reset)
  const markDownloadReady = usePipelineStore((s) => s.markDownloadReady)
  const { events, status, result, error, loadError } = useMigration(jobId)

  // A finished job means the user is at the hand-off, so the step indicator
  // should say Download rather than leaving Migration lit with the download
  // button already on screen. Display state only — the job data is untouched.
  useEffect(() => {
    if (status === 'succeeded') markDownloadReady()
  }, [status, markDownloadReady])

  const byStage = new Map<MigrationStage, StageView>()
  let llmCalls = 0
  for (const ev of events) {
    const v = byStage.get(ev.stage) ?? {}
    if (ev.type === 'stage_started') v.started = ev
    if (ev.type === 'stage_completed') v.completed = ev
    byStage.set(ev.stage, v)
    if (ev.data?.llmCalls != null) llmCalls = ev.data.llmCalls
  }
  if (result) llmCalls = result.llmCalls

  const repairEvents = events.filter((e) => e.stage === 'repair')
  // On a hard failure the failing stage never gets a stage_completed; mark it
  // failed (rather than leave it spinning) using the terminal error's stage.
  const failedStage = status === 'failed' ? (error?.stage ?? null) : null

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="migrate-screen">
      <StepHeader
        stage="migrate"
        title={
          status === 'succeeded'
            ? 'Migration complete'
            : status === 'failed'
              ? 'Migration failed'
              : 'Migrating…'
        }
        description={
          status === 'succeeded'
            ? 'Every row below completed on the backend. The React Native project is ready to take away.'
            : 'A live readout of the engine. Each row completes only when the backend says it did — no timers, no guesses.'
        }
        actions={<StreamStatus status={status} />}
      />

      {/* The LLM-call counter — the product's thesis, shown proudly. */}
      <LlmCallout llmCalls={llmCalls} />

      {loadError && (
        <div className="flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger/8 px-3.5 py-3 text-[13px] text-danger">
          <AlertIcon className="mt-0.5 shrink-0 text-[16px]" />
          <span>{loadError}</span>
        </div>
      )}

      {/* Live stage readout */}
      <Panel title="Pipeline" flush>
        <ul className="divide-y divide-line/60">
          {STAGE_ROWS.map(({ stage, label }) => (
            <StageRow
              key={stage}
              stage={stage}
              label={label}
              view={byStage.get(stage)}
              failed={failedStage === stage}
            />
          ))}
          {repairEvents.length > 0 && (
            <RepairRow events={repairEvents} view={byStage.get('repair')} />
          )}
        </ul>
      </Panel>

      {status === 'failed' && error && <FailurePanel error={error} onReset={reset} />}

      {status === 'succeeded' && result && (
        <ResultPanel result={result} report={report} onReset={reset} />
      )}
    </div>
  )
}

// --- pieces -----------------------------------------------------------------

function StreamStatus({ status }: { status: JobStatus }) {
  const live = status === 'queued' || status === 'running'
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          live && 'animate-pulse bg-signal',
          status === 'succeeded' && 'bg-pos',
          status === 'failed' && 'bg-danger',
        )}
      />
      <span className="font-mono text-[11.5px] tracking-wide text-ink-3">
        {live ? 'streaming' : status}
      </span>
    </div>
  )
}

function LlmCallout({ llmCalls }: { llmCalls: number }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-ai/25 bg-ai/8 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="eyebrow text-ai/80">AI Resolution Engine</div>
        <p className="mt-0.5 text-[13px] text-ink-3">
          Rules did the rest — the LLM is a scalpel, used only where reasoning is required.
        </p>
      </div>
      <div className="sm:text-right">
        <div className="tnum text-[34px] leading-none font-semibold text-ai tabular-nums">
          <span data-testid="migrate-llm-calls">{llmCalls}</span>
        </div>
        <div className="eyebrow mt-1">LLM call{llmCalls === 1 ? '' : 's'}</div>
      </div>
    </div>
  )
}

function stageStateOf(view: StageView | undefined): StageState {
  if (!view?.started && !view?.completed) return 'pending'
  if (view.completed) {
    const d = view.completed.data
    // A stage that ran and reported passed=false is a failed stage.
    if (d && d.ran === true && d.passed === false) return 'failed'
    return 'done'
  }
  return 'running'
}

function StageIndicator({ state }: { state: StageState }) {
  if (state === 'done')
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-pos/15 text-pos">
        <CheckIcon className="text-[15px]" />
      </span>
    )
  if (state === 'failed')
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-danger/15 text-danger">
        <AlertIcon className="text-[15px]" />
      </span>
    )
  if (state === 'running')
    return <span className="h-4 w-4 animate-spin rounded-full border-2 border-signal/25 border-t-signal" />
  return <span className="h-2 w-2 rounded-full border border-line-strong" />
}

function StageRow({
  stage,
  label,
  view,
  failed,
}: {
  stage: MigrationStage
  label: string
  view: StageView | undefined
  failed?: boolean
}) {
  const computed = stageStateOf(view)
  const state: StageState = failed && computed !== 'done' ? 'failed' : computed
  const d = view?.completed?.data
  return (
    <li
      data-testid={`stage-${stage}`}
      data-state={state}
      className={cn('flex items-center gap-4 px-5 py-3.5', state === 'running' && 'bg-surface-2/50')}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center">
        <StageIndicator state={state} />
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn('text-[15px] font-medium', state === 'pending' ? 'text-ink-4' : 'text-ink')}>
          {label}
        </div>
        {d && <div className="mt-0.5 font-mono text-[11.5px] text-ink-3">{stageDetail(stage, d)}</div>}
      </div>
      {d && stageVerdict(stage, d)}
    </li>
  )
}

/** Real payload numbers for a completed stage — observed, never derived. */
function stageDetail(stage: MigrationStage, d: NonNullable<MigrationEvent['data']>): string {
  if (stage === 'emit') {
    const parts = [
      d.filesConverted != null && `${d.filesConverted} converted`,
      d.filesEmitted != null && `${d.filesEmitted} emitted`,
      d.filesSkipped != null && `${d.filesSkipped} skipped`,
      d.todoCount != null && `${d.todoCount} TODOs`,
      d.navigatorShape && `nav: ${d.navigatorShape}`,
    ].filter(Boolean)
    return parts.join(' · ')
  }
  if (stage === 'install') {
    if (d.ran === false) return d.skippedReason ?? 'skipped'
    return d.installSkipped ? 'cached (node_modules present)' : 'dependencies installed'
  }
  if (stage === 'typecheck' || stage === 'bundle') {
    if (d.ran === false) return d.skippedReason ?? 'skipped'
    return `${d.errorCount ?? 0} error(s) · ${d.diagnosticsFound ?? 0} diagnostic(s)`
  }
  return ''
}

function stageVerdict(stage: MigrationStage, d: NonNullable<MigrationEvent['data']>) {
  if ((stage === 'typecheck' || stage === 'bundle') && d.ran) {
    return (
      <Badge tone={d.passed ? 'pos' : 'danger'}>{d.passed ? 'PASS' : 'FAIL'}</Badge>
    )
  }
  if (stage === 'install' && d.installed != null) {
    return <Badge tone={d.installed ? 'pos' : 'danger'}>{d.installed ? 'ready' : 'failed'}</Badge>
  }
  return null
}

function RepairRow({ events, view }: { events: MigrationEvent[]; view: StageView | undefined }) {
  const state = view?.completed ? 'done' : 'running'
  const rounds = events.filter((e) => e.type === 'stage_completed')
  const last = rounds[rounds.length - 1]?.data
  return (
    <li data-testid="stage-repair" className="flex items-center gap-4 px-5 py-3.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center">
        <StageIndicator state={state as StageState} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-medium text-ink">AI repair</div>
        {last?.repairRound != null && (
          <div className="mt-0.5 font-mono text-[11.5px] text-ink-3">
            round {last.repairRound} of {last.maxRepairRounds} · {last.repairAttempts ?? 0} attempt(s)
          </div>
        )}
      </div>
    </li>
  )
}

function FailurePanel({ error, onReset }: { error: MigrationError; onReset: () => void }) {
  return (
    <Panel testId="migrate-error" className="border-danger/30">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger">
          <AlertIcon className="text-[18px]" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold text-ink">
            Failed during <span className="text-danger">{error.stage ?? 'migration'}</span>
          </h2>
          <p className="mt-1 font-mono text-[13px] text-ink-4">{error.type}</p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{error.message}</p>
          <div className="mt-4">
            <Button variant="secondary" onClick={onReset}>
              Start over
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  )
}

function ResultPanel({
  result,
  report,
  onReset,
}: {
  result: MigrationResult
  report: AnalysisReport | null
  onReset: () => void
}) {
  const scores = result.validatedScores
  const runId = result.runId
  return (
    <Panel
      testId="migrate-result"
      // "Review" is the name of step 03; this panel is the Download hand-off.
      eyebrow="Hand-off · validated"
      title="The migrated project compiles and bundles"
      actions={
        <div className="flex items-center gap-2">
          <Badge tone={result.typecheckPassed ? 'pos' : 'danger'} dot>
            <span data-testid="migrate-tsc">tsc {result.typecheckPassed ? 'PASS' : 'FAIL'}</span>
          </Badge>
          <Badge tone={result.bundlePassed ? 'pos' : result.bundleRan ? 'danger' : 'neutral'} dot>
            <span data-testid="migrate-metro">
              Metro {result.bundleRan ? (result.bundlePassed ? 'PASS' : 'FAIL') : 'skipped'}
            </span>
          </Badge>
        </div>
      }
    >
      {/* Predicted (from the Report) BESIDE validated (from the run) — two axes. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <AxisCard
          eyebrow="Predicted · analyzer"
          coverage={report?.coverage ?? null}
          confidence={report?.confidence ?? null}
          coverageTestId="predicted-coverage"
          confidenceTestId="predicted-confidence"
          tone="ink"
        />
        {/* Strict coverage is the validated headline: a file counts only when
            nothing was left unresolved in it. The more forgiving
            compiles-and-bundles figure sits beneath, labelled — never swapped
            in for the headline. */}
        <AxisCard
          eyebrow="Validated · tsc + Metro"
          coverageLabel="Coverage · strict"
          coverage={scores?.coverage ?? null}
          confidence={scores?.confidence ?? null}
          coverageTestId="validated-coverage"
          confidenceTestId="validated-confidence"
          footnote={
            scores ? (
              <>
                compiles &amp; bundles{' '}
                <span className="tnum" data-testid="validated-compiling-coverage">
                  {formatScorePercent(scores.workingCoverage)}
                </span>{' '}
                · {scores.totalUnitCount} units measured
              </>
            ) : null
          }
          tone="signal"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 text-center sm:grid-cols-3">
        <Stat label="Files converted" value={result.filesConverted} />
        <Stat label="Residue TODOs" value={result.todoCount} />
        <Stat label="Repair rounds" value={result.repairRounds} />
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <span className="text-[13px] text-ink-3">
          {runId ? 'The React Native project is ready to download.' : 'Migration finished.'}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onReset}>
            Start over
          </Button>
          {runId && (
            <a
              data-testid="download-button"
              href={downloadUrl(runId)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-signal px-4 text-sm font-semibold text-void shadow-[0_0_0_1px_var(--color-signal-deep)] transition-colors hover:bg-[color-mix(in_oklab,var(--color-signal)_88%,white)]"
            >
              <FileZipIcon className="text-[16px]" />
              Download RN project
            </a>
          )}
        </div>
      </div>
    </Panel>
  )
}

function AxisCard({
  eyebrow,
  coverage,
  confidence,
  coverageLabel = 'Coverage',
  coverageTestId,
  confidenceTestId,
  footnote,
  tone,
}: {
  eyebrow: string
  coverage: number | null
  confidence: number | null
  coverageLabel?: string
  coverageTestId: string
  confidenceTestId: string
  footnote?: ReactNode
  tone: 'ink' | 'signal'
}) {
  const color = tone === 'signal' ? 'text-signal' : 'text-ink'
  return (
    <div className="rounded-lg border border-line bg-surface-0 p-4">
      <div className="eyebrow">{eyebrow}</div>
      <div className="mt-3 flex gap-6">
        <AxisValue label={coverageLabel} value={coverage} testId={coverageTestId} color={color} />
        <AxisValue label="Confidence" value={confidence} testId={confidenceTestId} color={color} />
      </div>
      {footnote != null && <div className="mt-3 text-xs text-ink-4">{footnote}</div>}
    </div>
  )
}

/**
 * One 0–100 axis. A null value means the score was never measured (an empty
 * population), and it renders as "n/a" with NO percent sign — a bare "—%" would
 * still read as a measurement that came out empty rather than one never taken.
 */
function AxisValue({
  label,
  value,
  testId,
  color,
}: {
  label: string
  value: number | null
  testId: string
  color: string
}) {
  return (
    <div>
      <div className={cn('tnum text-[26px] leading-none font-semibold tabular-nums', color)}>
        <span data-testid={testId}>{value != null ? formatScore(value) : 'n/a'}</span>
        {value != null && <span className="text-sm text-ink-4">%</span>}
      </div>
      <div className="eyebrow mt-1.5">{label}</div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-surface-0 px-3 py-2.5">
      <div className="tnum text-xl font-semibold text-ink tabular-nums">{value}</div>
      <div className="eyebrow mt-1">{label}</div>
    </div>
  )
}
