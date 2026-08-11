import { motion, useReducedMotion } from 'framer-motion'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { DomainsPanel } from '../components/report/DomainsPanel'
import { FindingsPanel } from '../components/report/FindingsPanel'
import { LibrariesTable } from '../components/report/LibrariesTable'
import { MetricsHeader } from '../components/report/MetricsHeader'
import { ReadinessChecklist } from '../components/report/ReadinessChecklist'
import { ScoreBreakdown } from '../components/report/ScoreBreakdown'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Stat } from '../components/ui/Metric'
import { StepHeader } from '../components/StepHeader'
import { ArrowRightIcon, ChevronDownIcon } from '../components/icons'
import { cn } from '../lib/cn'
import { DUR, HOUSE_EASE, STAGGER, enter } from '../lib/motion'
import { usePipelineStore } from '../store/pipelineStore'
import type { AnalysisReport } from '../types/api'

/** A section wrapper that fades its contents up as they enter the report. */
function Section({ children, index = 0 }: { children: ReactNode; index?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={enter(index * STAGGER)}
    >
      {children}
    </motion.div>
  )
}

export function ReportScreen() {
  const report = usePipelineStore((s) => s.report)
  const plan = usePipelineStore((s) => s.plan)
  const planStatus = usePipelineStore((s) => s.planStatus)
  const reset = usePipelineStore((s) => s.reset)
  const goToPlan = usePipelineStore((s) => s.goToPlan)

  if (!report) return null

  return (
    // Narrower than the shell so the step-to-step width change is a gradient
    // (768 column → 1024 report → full-width DAG) rather than a jump.
    <div className="mx-auto max-w-5xl space-y-6" data-testid="report-screen">
      <ReportHeader report={report} onReset={reset} onPlan={goToPlan} />

      {/* Lead: the readable-in-three-seconds answer. The plan is prefetched
          behind the analysis reveal, so the decisions verdict is accurate on
          the first visit; `planStatus` covers the case where it is still in
          flight. Never guessed. */}
      <ReadinessChecklist report={report} plan={plan} planStatus={planStatus} />

      {/* Everything that used to lead this screen, intact, one click away. */}
      <FullAnalysis report={report} />
    </div>
  )
}

/**
 * The detailed report, demoted to a collapsed section. The content is kept
 * mounted and hidden (rather than unmounted) so nothing is rebuilt or lost on
 * every toggle; `hidden` keeps it out of the accessibility tree while closed.
 */
function FullAnalysis({ report }: { report: AnalysisReport }) {
  const [open, setOpen] = useState(false)
  const reduceMotion = useReducedMotion() === true

  return (
    <div>
      <button
        type="button"
        data-testid="full-analysis-toggle"
        aria-expanded={open}
        aria-controls="full-analysis"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-4 rounded-xl border border-line bg-surface-1 px-5 py-4 text-left shadow-[var(--shadow-panel)] transition-colors outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-signal/60"
      >
        <div className="min-w-0">
          <div className="eyebrow mb-1.5">Detail</div>
          <h2 className="text-[16px] font-semibold tracking-tight text-ink">
            {open ? 'Hide full analysis' : 'View full analysis'}
          </h2>
          <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-ink-3">
            Coverage and Confidence, the score breakdown, every library, domain
            risk, and all blockers and warnings.
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-2 font-mono text-[13px] text-ink-3">
          {open ? 'collapse' : 'expand'}
          <ChevronDownIcon
            className={cn(
              'text-[18px] transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        </span>
      </button>

      <div id="full-analysis" data-testid="full-analysis" hidden={!open}>
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: open ? 1 : 0, y: open ? 0 : 6 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: DUR.enter, ease: HOUSE_EASE }
          }
          className="mt-6 space-y-6"
        >
          <Section index={0}>
            <MetricsHeader report={report} />
          </Section>

          <Section index={1}>
            <SummaryTiles report={report} />
          </Section>

          <Section index={2}>
            <ScoreBreakdown
              contributions={report.contributions ?? []}
              coverage={report.coverage}
            />
          </Section>

          <Section index={3}>
            <LibrariesTable libraries={report.libraries ?? []} />
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section index={4}>
              <DomainsPanel domains={report.domains ?? []} />
            </Section>
            <Section index={5}>
              <FindingsPanel
                blockers={report.blockers ?? []}
                warnings={report.warnings ?? []}
              />
            </Section>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

function ReportHeader({
  report,
  onReset,
  onPlan,
}: {
  report: AnalysisReport
  onReset: () => void
  onPlan: () => void
}) {
  return (
    <StepHeader
      stage="report"
      title={report.projectName}
      badge={
        <Badge tone="signal" dot>
          analyzed
        </Badge>
      }
      description="A deterministic read of the project. Nothing has been migrated yet."
      actions={
        <>
          <Button variant="ghost" onClick={onReset}>
            New analysis
          </Button>
          <Button variant="primary" onClick={onPlan}>
            Plan the migration
            <ArrowRightIcon className="text-[16px]" />
          </Button>
        </>
      }
    />
  )
}

function SummaryTiles({ report }: { report: AnalysisReport }) {
  const s = report.summary
  const tiles = [
    { label: 'Components', value: s.componentCount },
    { label: 'Pages', value: s.pageCount },
    { label: 'Routes', value: s.routeCount },
    { label: 'API endpoints', value: s.apiEndpointCount },
    { label: 'Stores', value: s.storeCount },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <Stat key={t.label} label={t.label} value={t.value.toLocaleString()} />
      ))}
    </div>
  )
}
