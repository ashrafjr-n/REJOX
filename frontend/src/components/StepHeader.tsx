import type { ReactNode } from 'react'

import { stageEyebrow } from '../lib/steps'
import { usePipelineStore } from '../store/pipelineStore'
import type { Stage } from '../store/pipelineStore'

/**
 * The header every pipeline step wears. One eyebrow / title / description /
 * actions block, so moving between steps changes the content and nothing else.
 *
 * The eyebrow is derived from the step registry rather than written per screen,
 * which is what keeps it in step with the indicator in the header — including
 * when the Decisions step is omitted or the migration finishes and the flow is
 * really at Download.
 */
export function StepHeader({
  stage,
  title,
  badge,
  description,
  actions,
}: {
  stage: Stage
  title: ReactNode
  /** Optional pill rendered inline after the title. */
  badge?: ReactNode
  description?: ReactNode
  /** Right-aligned controls (buttons, a status readout). */
  actions?: ReactNode
}) {
  const plan = usePipelineStore((s) => s.plan)
  const downloadReady = usePipelineStore((s) => s.downloadReady)

  return (
    // Actions sit on the title's line, not the block's baseline, so a one-line
    // description and a two-line one put the buttons in the same place.
    <header>
      <div className="eyebrow mb-2">
        {stageEyebrow(stage, plan, downloadReady)}
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate text-[24px] leading-tight font-semibold tracking-tight text-ink">
            {title}
          </h1>
          {badge}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
      {description && (
        <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-3">
          {description}
        </p>
      )}
    </header>
  )
}
