import type { ReactNode } from 'react'

import { cn } from '../lib/cn'
import { useHealth } from '../lib/useHealth'
import type { HealthStatus } from '../lib/useHealth'
import { usePipelineStore } from '../store/pipelineStore'
import type { Stage } from '../store/pipelineStore'
import { CircuitIcon } from './icons'

/** The pipeline stages, in order, for the header stepper. */
const STEPPER: { id: Stage; label: string }[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'analyzing', label: 'Analyze' },
  { id: 'report', label: 'Report' },
  { id: 'plan', label: 'Plan' },
  { id: 'ask', label: 'Ask' },
]

function Stepper({ stage }: { stage: Stage }) {
  // 'submitted' is past the last stage — everything reads as done.
  const activeIndex =
    stage === 'submitted' ? STEPPER.length : STEPPER.findIndex((s) => s.id === stage)
  return (
    <nav className="hidden items-center gap-1 md:flex" aria-label="Pipeline progress">
      {STEPPER.map((step, i) => {
        const state =
          i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'todo'
        return (
          <div key={step.id} className="flex items-center gap-1">
            <span
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
                {String(i + 1).padStart(2, '0')}
              </span>
              {step.label}
            </span>
            {i < STEPPER.length - 1 && (
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
