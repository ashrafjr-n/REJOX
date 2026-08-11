import { LevelMetric, ScoreMetric } from '../ui/Metric'
import { Tooltip } from '../ui/Tooltip'
import { InfoIcon } from '../icons'
import { RISK_LABEL, RISK_TONE } from '../../lib/display'
import type { AnalysisReport, RiskLevel } from '../../types/api'

const RISK_ORDER: RiskLevel[] = ['low', 'medium', 'high']

function InfoAside({ content }: { content: React.ReactNode }) {
  return (
    <Tooltip content={content} width={280}>
      <span className="text-ink-4 transition-colors hover:text-ink-2">
        <InfoIcon className="text-[15px]" />
      </span>
    </Tooltip>
  )
}

/**
 * The three axes, held apart on purpose. Coverage and Confidence are NOT one
 * number — the tooltips make the distinction legible at a glance, and Risk is
 * rendered as a categorical gauge so it never reads as a percentage.
 */
export function MetricsHeader({ report }: { report: AnalysisReport }) {
  const worstDomain = (report.domains ?? []).find((d) => d.risk === report.risk)

  return (
    <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-3">
      <div className="bg-surface-1 p-6">
        <ScoreMetric
          label="Coverage"
          testId="metric-coverage"
          value={report.coverage}
          tone="signal"
          caption="How much of the project can be migrated."
          aside={
            <InfoAside
              content={
                <>
                  <strong className="text-ink">Coverage</strong> — the share of
                  the project rules and AI can carry across.{' '}
                  <em className="text-ink-3">How much</em> migrates.
                </>
              }
            />
          }
        />
      </div>

      <div className="bg-surface-1 p-6">
        <ScoreMetric
          label="Confidence"
          testId="metric-confidence"
          value={report.confidence}
          tone="ai"
          caption="How sure we are that what migrated is correct."
          aside={
            <InfoAside
              content={
                <>
                  <strong className="text-ink">Confidence</strong> — computed
                  from provenance (deterministic vs AI-resolved), never
                  estimated. <em className="text-ink-3">How sure</em>, not how
                  much. Distinct from Coverage on purpose.
                </>
              }
            />
          }
        />
      </div>

      <div className="bg-surface-1 p-6">
        <LevelMetric
          label="Risk"
          testId="metric-risk"
          segments={RISK_ORDER}
          activeIndex={RISK_ORDER.indexOf(report.risk)}
          tone={RISK_TONE[report.risk]}
          valueLabel={RISK_LABEL[report.risk]}
          caption={
            worstDomain
              ? `Driven by ${worstDomain.domain}.`
              : 'Worst detected functional-domain risk.'
          }
          aside={
            <InfoAside
              content={
                <>
                  <strong className="text-ink">Risk</strong> — the worst risk
                  among detected functional domains. Categorical, not a
                  percentage.
                </>
              }
            />
          }
        />
      </div>
    </div>
  )
}
