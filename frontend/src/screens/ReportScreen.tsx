import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

import { DomainsPanel } from '../components/report/DomainsPanel'
import { FindingsPanel } from '../components/report/FindingsPanel'
import { LibrariesTable } from '../components/report/LibrariesTable'
import { MetricsHeader } from '../components/report/MetricsHeader'
import { ScoreBreakdown } from '../components/report/ScoreBreakdown'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Stat } from '../components/ui/Metric'
import { ArrowRightIcon } from '../components/icons'
import { usePipelineStore } from '../store/pipelineStore'
import type { AnalysisReport } from '../types/api'

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
  const reset = usePipelineStore((s) => s.reset)
  const goToPlan = usePipelineStore((s) => s.goToPlan)

  if (!report) return null

  return (
    <div className="space-y-6" data-testid="report-screen">
      <ReportHeader report={report} onReset={reset} onPlan={goToPlan} />

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
