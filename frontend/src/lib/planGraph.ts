/**
 * Pure layout math for the Plan DAG — no React, no side effects, so it can be
 * asserted directly. Everything derives from real plan data:
 *   - waves: longest-path topological layering over `dependsOn`
 *     (leaves → composites → pages), the ordering the planner already encodes.
 *   - findings: a step's targets cross-referenced against the plan's
 *     manualReviewCandidates — the real per-step "needs review" signal.
 */
import type { ManualReviewCandidate, PlanStep } from '../types/api'

export const COLUMN_WIDTH = 300
export const ROW_HEIGHT = 132

export interface WaveLayout {
  /** Steps grouped by wave index (0-based), each wave sorted by `order`. */
  waves: PlanStep[][]
  /** stepId → wave index. */
  waveOf: Map<string, number>
}

/** Longest-path layering: a step's wave is 1 + the max wave of its deps. */
export function computeWaves(steps: PlanStep[]): WaveLayout {
  const byId = new Map(steps.map((s) => [s.id, s]))
  const memo = new Map<string, number>()
  const visiting = new Set<string>()

  const waveOf = (id: string): number => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    const step = byId.get(id)
    const deps = (step?.dependsOn ?? []).filter((d) => byId.has(d))
    if (!step || deps.length === 0) {
      memo.set(id, 0)
      return 0
    }
    if (visiting.has(id)) return 0 // defensive cycle guard (plan is a DAG)
    visiting.add(id)
    const wave = 1 + Math.max(...deps.map(waveOf))
    visiting.delete(id)
    memo.set(id, wave)
    return wave
  }

  const map = new Map<string, number>()
  for (const s of steps) map.set(s.id, waveOf(s.id))

  const maxWave = steps.length
    ? Math.max(...steps.map((s) => map.get(s.id) ?? 0))
    : -1
  const waves: PlanStep[][] = Array.from({ length: maxWave + 1 }, () => [])
  for (const s of steps) waves[map.get(s.id) ?? 0].push(s)
  for (const w of waves) w.sort((a, b) => a.order - b.order)

  return { waves, waveOf: map }
}

/** Grid position for a node, columns = waves (left→right). */
export function positionOf(waveIndex: number, rowIndex: number): { x: number; y: number } {
  return { x: waveIndex * COLUMN_WIDTH, y: rowIndex * ROW_HEIGHT }
}

/**
 * The manual-review candidates whose componentId is one of this step's targets
 * — the step's real "needs review" findings. Empty for a clean step.
 */
export function findingsForStep(
  step: PlanStep,
  candidates: ManualReviewCandidate[],
): ManualReviewCandidate[] {
  const targets = new Set(step.targets ?? [])
  return candidates.filter((c) => targets.has(c.componentId))
}

/** A step needs attention if it's gated by a decision or carries review findings. */
export function stepIsFlagged(
  step: PlanStep,
  candidates: ManualReviewCandidate[],
): boolean {
  return (
    (step.affectedByQuestions ?? []).length > 0 ||
    findingsForStep(step, candidates).length > 0
  )
}
