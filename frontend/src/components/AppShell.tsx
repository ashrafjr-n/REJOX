import type { ReactNode } from 'react'

import { cn } from '../lib/cn'
import { visibleSteps } from '../lib/steps'
import { useHealth } from '../lib/useHealth'
import type { HealthStatus } from '../lib/useHealth'
import { useHeaderAutoHide } from '../lib/useHeaderAutoHide'
import { usePipelineStore } from '../store/pipelineStore'
import type { Stage } from '../store/pipelineStore'
import { SiteHeader } from './SiteHeader'

/**
 * The indicator reads the shared step registry (lib/steps.ts) — the same source
 * every screen's eyebrow reads, so the two can never drift apart. That registry
 * also owns the two dynamic cases: a plan with no questions drops the Decisions
 * step, and a finished migration moves the highlight onto Download.
 */
function Stepper({ stage }: { stage: Stage }) {
  const plan = usePipelineStore((s) => s.plan)
  const downloadReady = usePipelineStore((s) => s.downloadReady)

  const steps = visibleSteps(plan, downloadReady)
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
              // The marketing header's nav-item treatment, exactly: a pill that
              // is light-silver-on-black when it is the current one and quiet
              // otherwise.
              className={cn(
                'flex items-center gap-2 rounded-full px-3 py-1 text-[13px] tracking-tight transition-colors',
                state === 'active' && 'bg-ink-2 font-semibold text-void',
                state === 'done' && 'font-medium text-ink-2',
                state === 'todo' && 'font-medium text-ink-4',
              )}
            >
              <span
                className={cn(
                  'font-mono text-[11.5px] tabular-nums',
                  state === 'active' ? 'text-void/70' : 'text-ink-4',
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
      <span className={cn('font-mono text-[11.5px] tracking-wide', meta.text)}>
        {meta.label}
      </span>
    </div>
  )
}

/** Height reserved for the fixed capsule header (top: 20px + its own height). */
const HEADER_SPACE = 84

export function AppShell({ children }: { children: ReactNode }) {
  const stage = usePipelineStore((s) => s.stage)
  const reset = usePipelineStore((s) => s.reset)
  // Same state the capsule uses, so the step bar tracks it exactly: parked
  // below the header while it is up, sliding to the top edge once it hides.
  const headerHidden = useHeaderAutoHide()

  return (
    <div className="rx-app app-bg min-h-screen text-ink">
      {/* The site's own chrome, identical to /, /architecture and /docs: same
          component, same nav, same hide-on-scroll, and its logo links home
          (this is not the home page, so it is a <Link to="/">, not a
          scroll-to-top). The pipeline's step bar lives below it, untouched. */}
      <SiteHeader />

      {/* Clears the fixed capsule so the step bar starts directly beneath it. */}
      <div
        className="relative flex min-h-screen flex-col"
        style={{ paddingTop: HEADER_SPACE }}
      >
        <header
          className="sticky z-40 border-b border-line/70 bg-void/80 backdrop-blur-xl transition-[top] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ top: headerHidden ? 0 : HEADER_SPACE }}
        >
          <div className="flex h-14 items-center justify-between gap-6 px-[var(--rx-frame-gutter)]">
            {/* The wordmark now lives in the capsule above, so this bar carries
                only the tool's own controls: where you are, a way back to the
                start, and engine liveness. */}
            <button
              onClick={reset}
              className="label-mono shrink-0 rounded-full px-2 py-1 whitespace-nowrap transition-colors outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-signal/60"
            >
              start over
            </button>

            <Stepper stage={stage} />

            <HealthIndicator />
          </div>
        </header>

        <main
          className="mx-auto w-full max-w-[1240px] flex-1 px-6 pb-14"
          style={{ paddingTop: 40 }}
        >
          {children}
        </main>

        <footer className="border-t border-line/60">
          <div className="px-[var(--rx-frame-gutter)] py-5">
            <p className="text-[13px] leading-relaxed text-ink-4">
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
