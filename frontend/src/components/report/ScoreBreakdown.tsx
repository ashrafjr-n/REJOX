import { motion } from 'framer-motion'

import { Panel } from '../ui/Panel'
import { cn } from '../../lib/cn'
import { formatDelta, formatScore } from '../../lib/display'
import type { ScoreContribution } from '../../types/api'

interface Props {
  contributions: ScoreContribution[]
  coverage: number
}

/**
 * The explainable score: the signed ScoreContribution list rendered like a
 * compiler's reasoning — every +N / −N against the fact that produced it.
 * The deltas sum to Coverage (the backend guarantees this), shown at the foot.
 */
export function ScoreBreakdown({ contributions, coverage }: Props) {
  const maxMagnitude = Math.max(1, ...contributions.map((c) => Math.abs(c.delta)))

  return (
    <Panel
      eyebrow="Coverage · Explained"
      title="How the score was reached"
      description="Every contribution is traceable to a fact in the knowledge graph. The signed deltas sum exactly to Coverage."
      flush
    >
      <ol className="divide-y divide-line/60">
        {contributions.map((c, i) => {
          const positive = c.delta >= 0
          return (
            <motion.li
              key={`${c.label}-${i}`}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.4), duration: 0.25 }}
              className="flex items-center gap-4 px-5 py-3"
            >
              {/* Signed delta */}
              <span
                className={cn(
                  'tnum w-14 shrink-0 text-right font-mono text-[15px] font-semibold tabular-nums',
                  positive ? 'text-pos' : 'text-danger',
                )}
              >
                {formatDelta(c.delta)}
              </span>

              {/* Label + reason */}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13.5px] font-medium text-ink">
                    {c.label}
                  </span>
                  {c.evidence && (
                    <span className="truncate font-mono text-[11px] text-ink-4">
                      {c.evidence}
                    </span>
                  )}
                </div>
                <div className="text-[12.5px] leading-snug text-ink-3">
                  {c.reason}
                </div>
              </div>

              {/* Magnitude bar */}
              <div className="hidden w-28 shrink-0 sm:block">
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{
                      width: `${(Math.abs(c.delta) / maxMagnitude) * 100}%`,
                    }}
                    transition={{ delay: Math.min(i * 0.03, 0.4), duration: 0.4 }}
                    className={cn(
                      'h-full rounded-full',
                      positive ? 'bg-pos/70' : 'bg-danger/70',
                    )}
                  />
                </div>
              </div>
            </motion.li>
          )
        })}
      </ol>

      {/* Total */}
      <div className="flex items-center justify-between border-t border-line-strong px-5 py-3.5">
        <span className="text-[13px] font-medium tracking-tight text-ink-2">
          = Coverage
        </span>
        <span
          data-testid="coverage-total"
          className="tnum font-mono text-[17px] font-semibold text-signal tabular-nums"
        >
          {formatScore(coverage)}
        </span>
      </div>
    </Panel>
  )
}
