import { create } from 'zustand'

import type {
  AnalysisReport,
  IngestedProject,
  MigrationPlan,
} from '../types/api'

/**
 * The stages this app renders. Upload → Analyze → Report → Plan → Ask, then a
 * terminal `submitted` once the migration job is started.
 */
export type Stage =
  | 'upload'
  | 'analyzing'
  | 'report'
  | 'plan'
  | 'ask'
  | 'submitted'

interface PipelineState {
  stage: Stage

  /** The landed upload (runId, detected root, candidate roots, warnings). */
  ingest: IngestedProject | null
  /**
   * Chosen candidate root (relative `path`), or null to use the detected root.
   * Only meaningful when the ingest reports more than one candidate.
   */
  selectedRoot: string | null

  /** The analysis result — the Migration Report the centerpiece renders. */
  report: AnalysisReport | null

  /** The migration plan — the step DAG + the Ask-stage questions. */
  plan: MigrationPlan | null
  /** Ask-stage answers, keyed by questionId → chosen optionId. */
  answers: Record<string, string>
  /** The job id returned by POST /api/migrate once answers are submitted. */
  jobId: string | null

  // --- transitions ---
  landUpload: (ingest: IngestedProject) => void
  setSelectedRoot: (root: string | null) => void
  beginAnalysis: () => void
  completeAnalysis: (report: AnalysisReport) => void
  goToPlan: () => void
  setPlan: (plan: MigrationPlan) => void
  goToAsk: () => void
  setAnswer: (questionId: string, optionId: string) => void
  markSubmitted: (jobId: string) => void
  reset: () => void
}

export const usePipelineStore = create<PipelineState>((set) => ({
  stage: 'upload',
  ingest: null,
  selectedRoot: null,
  report: null,
  plan: null,
  answers: {},
  jobId: null,

  landUpload: (ingest) => set({ ingest, selectedRoot: null }),
  setSelectedRoot: (selectedRoot) => set({ selectedRoot }),
  beginAnalysis: () => set({ stage: 'analyzing', report: null }),
  completeAnalysis: (report) => set({ report, stage: 'report' }),
  goToPlan: () => set({ stage: 'plan' }),
  setPlan: (plan) => set({ plan }),
  goToAsk: () => set({ stage: 'ask' }),
  setAnswer: (questionId, optionId) =>
    set((s) => ({ answers: { ...s.answers, [questionId]: optionId } })),
  markSubmitted: (jobId) => set({ jobId, stage: 'submitted' }),
  reset: () =>
    set({
      stage: 'upload',
      ingest: null,
      selectedRoot: null,
      report: null,
      plan: null,
      answers: {},
      jobId: null,
    }),
}))
