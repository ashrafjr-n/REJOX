import { create } from 'zustand'

/** The 8 stages of the Rejox migration pipeline (see CLAUDE.md). */
export type PipelineStage =
  | 'upload'
  | 'analysis'
  | 'report'
  | 'plan'
  | 'ask'
  | 'migrate'
  | 'review'
  | 'download'

interface PipelineState {
  stage: PipelineStage
  setStage: (stage: PipelineStage) => void
}

/** Tracks which pipeline stage the current migration is in. */
export const usePipelineStore = create<PipelineState>((set) => ({
  stage: 'upload',
  setStage: (stage) => set({ stage }),
}))
