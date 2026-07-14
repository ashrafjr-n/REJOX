import { Button } from '../components/ui/Button'
import { Panel } from '../components/ui/Panel'
import { CheckIcon } from '../components/icons'
import { usePipelineStore } from '../store/pipelineStore'

/**
 * Terminal confirmation for this slice: the migration job was accepted (202).
 * The live migrate/download screen is a later slice; here we honestly report
 * that the background job has started and surface its id.
 */
export function SubmittedScreen() {
  const jobId = usePipelineStore((s) => s.jobId)
  const reset = usePipelineStore((s) => s.reset)

  return (
    <div className="mx-auto max-w-lg pt-16">
      <Panel testId="submitted">
        <div className="flex flex-col items-center py-6 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-pos/15 text-pos">
            <CheckIcon className="text-[22px]" />
          </span>
          <div className="eyebrow mt-4">Stage 06 · Migrate</div>
          <h1 className="mt-2 text-[20px] font-semibold tracking-tight text-ink">
            Migration started
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-ink-2">
            The migration is running in the background (emit → install → tsc →
            Metro). Follow it via the job's event stream — the live progress
            screen is the next slice.
          </p>
          {jobId && (
            <div className="mt-4 rounded-md border border-line bg-surface-0 px-3 py-1.5 font-mono text-[12px] text-ink-3">
              job {jobId}
            </div>
          )}
          <div className="mt-6">
            <Button variant="secondary" onClick={reset}>
              Start over
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  )
}
