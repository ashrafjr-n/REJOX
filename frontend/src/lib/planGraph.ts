/**
 * Pure layout math for the Plan DAG — no React, no side effects.
 *
 * Waves and per-step findings are OWNED BY THE BACKEND (`step.wave`,
 * `step.findings`); this module only groups and positions what the Planner
 * already stated. It never recomputes the layering or re-derives findings.
 */
import type { PlanStep, StepFinding } from '../types/api'

export const COLUMN_WIDTH = 300
export const ROW_HEIGHT = 132

export interface WaveLayout {
  /** Steps grouped by `step.wave` (0-based), each wave sorted by `order`. */
  waves: PlanStep[][]
  /** stepId → wave index (straight from the backend). */
  waveOf: Map<string, number>
}

/** Group steps into columns by the backend-assigned `step.wave`. */
export function groupByWave(steps: PlanStep[]): WaveLayout {
  const waveOf = new Map<string, number>()
  let maxWave = -1
  for (const s of steps) {
    waveOf.set(s.id, s.wave)
    if (s.wave > maxWave) maxWave = s.wave
  }
  const waves: PlanStep[][] = Array.from({ length: maxWave + 1 }, () => [])
  for (const s of steps) waves[s.wave].push(s)
  for (const w of waves) w.sort((a, b) => a.order - b.order)
  return { waves, waveOf }
}

/** Grid position for a node, columns = waves (left→right). */
export function positionOf(waveIndex: number, rowIndex: number): { x: number; y: number } {
  return { x: waveIndex * COLUMN_WIDTH, y: rowIndex * ROW_HEIGHT }
}

/** This step's findings — stated by the Planner, not re-derived here. */
export function findingsForStep(step: PlanStep): StepFinding[] {
  return step.findings ?? []
}

/** A step needs attention if it's gated by a decision or carries findings. */
export function stepIsFlagged(step: PlanStep): boolean {
  return (
    (step.affectedByQuestions ?? []).length > 0 || (step.findings ?? []).length > 0
  )
}
