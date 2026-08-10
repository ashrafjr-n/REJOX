import type { ReactNode } from 'react'

import { cn } from '../lib/cn'
import { useHealth } from '../lib/useHealth'
import type { HealthStatus } from '../lib/useHealth'
import { usePipelineStore } from '../store/pipelineStore'
import type { Stage } from '../store/pipelineStore'
import { CircuitIcon } from './icons'

/**
 * The pipeline as the user reads it, in order — display only. `stages` names the
 * internal stages a step covers: the analyzing spinner and the Migration Report
 * it produces are one user-facing step (Understanding), and Download is the
 * terminal hand-off inside the Migration screen, so it owns no stage of its own.
 * `num` is fixed per step, so a step's number never shifts when another is
 * omitted.
 */
interface Step {
  id: string
  label: string
  num: string
  stages: Stage[]
}

const STEPPER: Step[] = [
  { id: 'upload', num: '01', label: 'Upload', stages: ['upload'] },
  { id: 'understanding', num: '02', label: 'Understanding', stages: ['analyzing', 'report'] },
  { id: 'review', num: '03', label: 'Review', stages: ['plan'] },
  { id: 'decisions', num: '04', label: 'Decisions', stages: ['ask'] },
  { id: 'migration', num: '05', label: 'Migration', stages: ['migrate'] },
  { id: 'download', num: '06', label: 'Download', stages: [] },
]

function Stepper({ stage }: { stage: Stage }) {
  const plan = usePipelineStore((s) => s.plan)

  // Read the real plan response: a plan that asks nothing has no Decisions step
  // at all. Until the plan lands (`plan === null`) nothing is known yet, so the
  // step stays visible rather than flickering out and back in.
  const hasDecisions = plan == null || (plan.questions ?? []).length > 0

  // With no Decisions step on show, the `ask` stage (which then only confirms
  // there is nothing to decide) reads as part of Review — so exactly one step is
  // highlighted on every screen, whichever shape the flow takes.
  const steps = hasDecisions
    ? STEPPER
    : STEPPER.filter((s) => s.id !== 'decisions').map((s) =>
        s.id === 'review' ? { ...s, stages: [...s.stages, 'ask' as Stage] } : s,
      )

  const activeIndex = steps.findIndex((s) => s.stages.includes(stage))
  return (
    <nav className="hidden items-center gap-1 md:flex" aria-label="Pipeline progress">
      {steps.map((step, i) => {
        const state =
          i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'todo'
        return (
          <div key={step.id} className="flex items-center gap-1">
            <span
              data-testid={`step-${step.id}`}
              data-state={state}
              className={cn(
                'flex items-center gap-2 rounded-md px-2.5 py-1 text-[12px] font-medium tracking-tight transition-colors',
                state === 'active' && 'bg-signal/10 text-signal',
                state === 'done' && 'text-ink-2',
                state === 'todo' && 'text-ink-4',
              )}
            >
              <span
                className={cn(
                  'font-mono text-[10px] tabular-nums',
                  state === 'active' ? 'text-signal' : 'text-ink-4',
                )}
              >
                {step.num}
              </span>
              {step.label}
            </span>
            {i < steps.length - 1 && (
              <span
                className={cn(
                  'h-px w-6',
                  i < activeIndex ? 'bg-ink-4' : 'bg-line',
                )}
              />
            )}
          </div>
        )
      })}
    </nav>
  )
}

/** Live backend liveness readout — reflects a real /health poll, three states. */
const HEALTH_META: Record<
  HealthStatus,
  { label: string; dot: string; text: string; pulse: boolean }
> = {
  checking: {
    label: 'checking engine…',
    dot: 'bg-ink-3',
    text: 'text-ink-3',
    pulse: true,
  },
  ready: {
    label: 'engine ready',
    dot: 'bg-pos shadow-[0_0_8px_var(--color-pos)]',
    text: 'text-ink-3',
    pulse: false,
  },
  unreachable: {
    label: 'engine unreachable',
    dot: 'bg-danger shadow-[0_0_8px_var(--color-danger)]',
    text: 'text-danger',
    pulse: true,
  },
}

function HealthIndicator() {
  const status = useHealth()
  const meta = HEALTH_META[status]
  return (
    <div
      className={cn(
        'items-center gap-2 rounded-md px-2 py-1',
        status === 'unreachable' && 'bg-danger/10 ring-1 ring-inset ring-danger/25',
        'hidden lg:flex',
      )}
      role="status"
      aria-live="polite"
    >
      <span
        className={cn('h-1.5 w-1.5 rounded-full', meta.dot, meta.pulse && 'animate-pulse')}
      />
      <span className={cn('font-mono text-[11px] tracking-wide', meta.text)}>
        {meta.label}
      </span>
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const stage = usePipelineStore((s) => s.stage)
  const reset = usePipelineStore((s) => s.reset)

  return (
    <div className="app-bg min-h-screen text-ink">
      <div className="pointer-events-none fixed inset-0 grid-veil" />

      <div className="relative flex min-h-screen flex-col">
        <header className="sticky top-0 z-40 border-b border-line/70 bg-void/70 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-6">
            <button
              onClick={reset}
              className="group flex items-center gap-3 outline-none"
              aria-label="Rejox — start over"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-md border border-line-strong bg-surface-1 text-signal transition-colors group-hover:border-signal/50">
                <CircuitIcon className="text-[17px]" />
              </span>
              <span className="flex flex-col items-start leading-none">
                <span className="text-[15px] font-semibold tracking-[0.14em] text-ink">
                  REJOX
                </span>
                <span className="mt-1 font-mono text-[10px] tracking-wide text-ink-3">
                  React → React Native
                </span>
              </span>
            </button>

            <Stepper stage={stage} />

            <HealthIndicator />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1240px] flex-1 px-6 py-10">
          {children}
        </main>

        <footer className="border-t border-line/60">
          <div className="mx-auto max-w-[1240px] px-6 py-5">
            <p className="text-[12px] leading-relaxed text-ink-4">
              <span className="text-ink-3">Core principle —</span> resolve by
              rules whatever rules can resolve; invoke AI only where genuine
              reasoning is required. Deterministic transforms first, AI as a
              scalpel for the residue.
            </p>
          </div>
        </footer>
      </div>
    </div>
  )
}
