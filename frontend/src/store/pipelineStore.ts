import { create } from 'zustand'

import type { AnalysisReport, IngestedProject } from '../types/api'

/**
 * The stages this slice renders. The full 8-stage pipeline lives in CLAUDE.md;
 * Upload → Report is the first vertical slice, so we drive these three.
 */
export type Stage = 'upload' | 'analyzing' | 'report'

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

  // --- transitions ---
  landUpload: (ingest: IngestedProject) => void
  setSelectedRoot: (root: string | null) => void
  beginAnalysis: () => void
  completeAnalysis: (report: AnalysisReport) => void
  reset: () => void
}

export const usePipelineStore = create<PipelineState>((set) => ({
  stage: 'upload',
  ingest: null,
  selectedRoot: null,
  report: null,

  landUpload: (ingest) => set({ ingest, selectedRoot: null }),
  setSelectedRoot: (selectedRoot) => set({ selectedRoot }),
  beginAnalysis: () => set({ stage: 'analyzing', report: null }),
  completeAnalysis: (report) => set({ report, stage: 'report' }),
  reset: () =>
    set({ stage: 'upload', ingest: null, selectedRoot: null, report: null }),
}))
