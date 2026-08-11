/**
 * The pipeline as the user reads it — one registry, used by both the header's
 * step indicator and every screen's own eyebrow.
 *
 * This exists because the two used to disagree: the indicator said "03 Review"
 * while the Plan screen's eyebrow said "Stage 03 · Migration Plan", and with no
 * decisions to make the indicator highlighted "03 Review" while the Decisions
 * screen still called itself "Stage 04". Now both read from here, so a step's
 * number and name are the same wherever they appear.
 *
 * `stages` names the internal stages a step covers: the analyzing reveal and
 * the Migration Report it produces are one user-facing step (Understanding).
 * `num` is fixed per step, so a step's number never shifts when another is
 * omitted.
 */
import type { MigrationPlan } from '../types/api'
import type { Stage } from '../store/pipelineStore'

export interface Step {
  id: string
  label: string
  num: string
  stages: Stage[]
}

export const STEPS: Step[] = [
  { id: 'upload', num: '01', label: 'Upload', stages: ['upload'] },
  {
    id: 'understanding',
    num: '02',
    label: 'Understanding',
    stages: ['analyzing', 'report'],
  },
  { id: 'review', num: '03', label: 'Review', stages: ['plan'] },
  { id: 'decisions', num: '04', label: 'Decisions', stages: ['ask'] },
  { id: 'migration', num: '05', label: 'Migration', stages: ['migrate'] },
  { id: 'download', num: '06', label: 'Download', stages: [] },
]

/**
 * A plan that asks nothing has no Decisions step at all. Until the plan lands
 * (`plan === null`) nothing is known yet, so the step stays visible rather than
 * flickering out and back in.
 */
export function hasDecisions(plan: MigrationPlan | null): boolean {
  return plan == null || (plan.questions ?? []).length > 0
}

/**
 * The steps actually on show. With no Decisions step, the `ask` stage (which
 * then only confirms there is nothing to decide) reads as part of Review — so
 * exactly one step is highlighted on every screen, whichever shape the flow
 * takes.
 *
 * `downloadReady` (the migration job succeeded) moves the `migrate` stage onto
 * the Download step: the user is looking at the hand-off, so that is the step
 * the indicator should name.
 */
export function visibleSteps(
  plan: MigrationPlan | null,
  downloadReady = false,
): Step[] {
  let steps = STEPS
  if (!hasDecisions(plan)) {
    steps = steps
      .filter((s) => s.id !== 'decisions')
      .map((s) =>
        s.id === 'review' ? { ...s, stages: [...s.stages, 'ask' as Stage] } : s,
      )
  }
  if (downloadReady) {
    steps = steps.map((s) => {
      if (s.id === 'migration') return { ...s, stages: [] }
      if (s.id === 'download') return { ...s, stages: ['migrate' as Stage] }
      return s
    })
  }
  return steps
}

/** The step a stage belongs to, under the current flow shape. */
export function stepForStage(
  stage: Stage,
  plan: MigrationPlan | null,
  downloadReady = false,
): Step | undefined {
  return visibleSteps(plan, downloadReady).find((s) => s.stages.includes(stage))
}

/** The screen eyebrow, e.g. "Stage 03 · Review". Always matches the indicator. */
export function stageEyebrow(
  stage: Stage,
  plan: MigrationPlan | null,
  downloadReady = false,
): string {
  const step = stepForStage(stage, plan, downloadReady)
  return step ? `Stage ${step.num} · ${step.label}` : ''
}
