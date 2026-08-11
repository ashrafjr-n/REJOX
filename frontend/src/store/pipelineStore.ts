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
  | 'migrate'

export interface PipelineState {
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
  /**
   * State of the *prefetch* of that plan, started during the analysis reveal so
   * the Review checklist can name the pending decisions on the first visit.
   * The Plan screen's own fetch is unaffected — it simply finds a plan already
   * there and skips.
   */
  planStatus: 'idle' | 'loading' | 'ready' | 'error'
  /**
   * The migration job reported success, so the user is at the download
   * hand-off — which is the step the indicator should be naming.
   */
  downloadReady: boolean
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
  beginPlanPrefetch: () => void
  failPlanPrefetch: () => void
  goToAsk: () => void
  setAnswer: (questionId: string, optionId: string) => void
  beginMigration: (jobId: string) => void
  markDownloadReady: () => void
  reset: () => void
}

export const usePipelineStore = create<PipelineState>((set) => ({
  stage: 'upload',
  ingest: null,
  selectedRoot: null,
  report: null,
  plan: null,
  planStatus: 'idle',
  downloadReady: false,
  answers: {},
  jobId: null,

  landUpload: (ingest) => set({ ingest, selectedRoot: null }),
  setSelectedRoot: (selectedRoot) => set({ selectedRoot }),
  beginAnalysis: () =>
    set({ stage: 'analyzing', report: null, plan: null, planStatus: 'idle' }),
  completeAnalysis: (report) => set({ report, stage: 'report' }),
  goToPlan: () => set({ stage: 'plan' }),
  setPlan: (plan) => set({ plan, planStatus: 'ready' }),
  beginPlanPrefetch: () => set({ planStatus: 'loading' }),
  failPlanPrefetch: () => set({ planStatus: 'error' }),
  goToAsk: () => set({ stage: 'ask' }),
  setAnswer: (questionId, optionId) =>
    set((s) => ({ answers: { ...s.answers, [questionId]: optionId } })),
  beginMigration: (jobId) => set({ jobId, stage: 'migrate' }),
  markDownloadReady: () => set({ downloadReady: true }),
  reset: () =>
    set({
      stage: 'upload',
      ingest: null,
      selectedRoot: null,
      report: null,
      plan: null,
      planStatus: 'idle',
      downloadReady: false,
      answers: {},
      jobId: null,
    }),
}))
