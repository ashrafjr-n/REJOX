import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'

import { Badge } from '../ui/Badge'
import { AlertIcon } from '../icons'
import { cn } from '../../lib/cn'
import { EFFORT_TONE, STEP_KIND_TONE } from '../../lib/display'
import type { PlanStep } from '../../types/api'

export interface PlanNodeData {
  step: PlanStep
  /** Manual-review findings that hit this step's targets. */
  findingCount: number
  /** Gated by an Ask-stage decision (affectedByQuestions non-empty). */
  gated: boolean
}

/** One migration step in the DAG. Flagged nodes (gated / review) read distinctly. */
export function PlanNode({ data, selected }: NodeProps<PlanNodeData>) {
  const { step, findingCount, gated } = data
  const flagged = gated || findingCount > 0
  const targets = step.targets ?? []
  const deps = step.dependsOn ?? []

  return (
    <div
      data-testid="plan-node"
      data-flagged={flagged ? 'true' : 'false'}
      className={cn(
        'w-[230px] rounded-xl border bg-surface-1 px-3 py-2.5 shadow-[var(--shadow-panel)] transition-colors',
        selected
          ? 'border-signal ring-2 ring-signal/40'
          : flagged
            ? 'border-warn/50'
            : 'border-line hover:border-ink-4',
      )}
    >
      <Handle type="target" position={Position.Left} style={{ background: 'var(--color-line-strong)', width: 7, height: 7 }} />

      <div className="flex items-center justify-between gap-2">
        <Badge tone={STEP_KIND_TONE[step.kind]}>{step.kind}</Badge>
        <span className="font-mono text-[11.5px] tabular-nums text-ink-4">
          #{step.order}
        </span>
      </div>

      <div className="mt-1.5 text-[13px] font-medium leading-snug text-ink">
        {step.title}
      </div>

      <div className="mt-2 flex items-center gap-2 text-[11.5px] text-ink-3">
        <Badge tone={EFFORT_TONE[step.estimatedEffort]}>{step.estimatedEffort}</Badge>
        <span className="font-mono tabular-nums">{targets.length} targets</span>
        {deps.length > 0 && (
          <span className="font-mono tabular-nums text-ink-4">{deps.length} deps</span>
        )}
      </div>

      {flagged && (
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-line/60 pt-2">
          {gated && (
            <Badge tone="signal" dot>
              decision
            </Badge>
          )}
          {findingCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-warn">
              <AlertIcon className="text-[13px]" />
              {findingCount} review
            </span>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Right} style={{ background: 'var(--color-line-strong)', width: 7, height: 7 }} />
    </div>
  )
}
