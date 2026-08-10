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
import { ArrowRightIcon, ChevronDownIcon } from '../components/icons'
import { cn } from '../lib/cn'
import { usePipelineStore } from '../store/pipelineStore'
import type { AnalysisReport } from '../types/api'

/** The pipeline's house easing. */
const HOUSE_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]

/** A section wrapper that fades its contents up as they enter the report. */
function Section({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut', delay }}
    >
      {children}
    </motion.div>
  )
}

export function ReportScreen() {
  const report = usePipelineStore((s) => s.report)
  const plan = usePipelineStore((s) => s.plan)
  const reset = usePipelineStore((s) => s.reset)
  const goToPlan = usePipelineStore((s) => s.goToPlan)

  if (!report) return null

  return (
    <div className="space-y-6" data-testid="report-screen">
      <ReportHeader report={report} onReset={reset} onPlan={goToPlan} />

      {/* Lead: the readable-in-three-seconds answer. The plan is only in the
          store once the user has been to the Plan step, so the "decisions
          pending" verdict appears on a return visit — never guessed. */}
      <ReadinessChecklist report={report} plan={plan} />

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
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">
            {open ? 'Hide full analysis' : 'View full analysis'}
          </h2>
          <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-ink-3">
            Coverage and Confidence, the score breakdown, every library, domain
            risk, and all blockers and warnings.
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-2 font-mono text-[12px] text-ink-3">
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
            reduceMotion ? { duration: 0 } : { duration: 0.3, ease: HOUSE_EASE }
          }
          className="mt-6 space-y-6"
        >
          <Section delay={0.05}>
            <MetricsHeader report={report} />
          </Section>

          <Section delay={0.1}>
            <SummaryTiles report={report} />
          </Section>

          <Section delay={0.15}>
            <ScoreBreakdown
              contributions={report.contributions ?? []}
              coverage={report.coverage}
            />
          </Section>

          <Section delay={0.2}>
            <LibrariesTable libraries={report.libraries ?? []} />
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section delay={0.25}>
              <DomainsPanel domains={report.domains ?? []} />
            </Section>
            <Section delay={0.3}>
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
    <div className="flex items-end justify-between gap-4">
      <div>
        <div className="eyebrow mb-2">Stage 02 · Migration Report</div>
        <div className="flex items-center gap-3">
          <h1 className="text-[24px] leading-tight font-semibold tracking-tight text-ink">
            {report.projectName}
          </h1>
          <Badge tone="signal" dot>
            analyzed
          </Badge>
        </div>
        <p className="mt-1.5 text-[13.5px] text-ink-3">
          A deterministic read of the project. Nothing has been migrated yet.
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onReset}>
          New analysis
        </Button>
        <Button variant="primary" onClick={onPlan}>
          Plan the migration
          <ArrowRightIcon className="text-[16px]" />
        </Button>
      </div>
    </div>
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
