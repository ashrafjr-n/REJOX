import { useEffect, useMemo, useState } from 'react'

import { ApiError, startMigration } from '../api/rejox'
import { StepHeader } from '../components/StepHeader'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Panel } from '../components/ui/Panel'
import { AlertIcon, ArrowRightIcon, CheckIcon } from '../components/icons'
import { cn } from '../lib/cn'
import { usePipelineStore } from '../store/pipelineStore'
import type { MigrationPlan, Question, SourceRequest } from '../types/api'

export function AskScreen() {
  const ingest = usePipelineStore((s) => s.ingest)
  const selectedRoot = usePipelineStore((s) => s.selectedRoot)
  const plan = usePipelineStore((s) => s.plan)
  const answers = usePipelineStore((s) => s.answers)
  const setAnswer = usePipelineStore((s) => s.setAnswer)
  const beginMigration = usePipelineStore((s) => s.beginMigration)
  const goToPlan = usePipelineStore((s) => s.goToPlan)
  const reset = usePipelineStore((s) => s.reset)

  const questions = useMemo(() => plan?.questions ?? [], [plan])
  const steps = useMemo(() => plan?.steps ?? [], [plan])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Default each question to the planner's recommended option (if any).
  useEffect(() => {
    for (const q of questions) {
      if (answers[q.id]) continue
      const rec = (q.options ?? []).find((o) => o.isRecommended)
      if (rec) setAnswer(q.id, rec.id)
    }
    // Only on question set changing; setAnswer is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions])

  // A dependent question only applies once its trigger option is chosen.
  const visibleQuestions = questions.filter(
    (q) => !q.dependsOn || answers[q.dependsOn.questionId] === q.dependsOn.optionId,
  )

  const unanswered = visibleQuestions.filter((q) => q.required && !answers[q.id])
  const canSubmit = unanswered.length === 0 && !submitting

  async function submit() {
    if (!ingest) {
      reset()
      return
    }
    setError(null)
    setSubmitting(true)
    const source: SourceRequest = selectedRoot
      ? { runId: ingest.runId, root: selectedRoot }
      : { runId: ingest.runId }
    // Send only the visible questions' answers — a hidden dependent question
    // must not leak a stale answer into the migration.
    const visibleIds = new Set(visibleQuestions.map((q) => q.id))
    const payload = Object.fromEntries(
      Object.entries(answers).filter(([id]) => visibleIds.has(id)),
    )
    try {
      const job = await startMigration(source, payload)
      beginMigration(job.jobId)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the migration.')
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <StepHeader
        stage="ask"
        title={
          questions.length > 0
            ? `${questions.length} decision${questions.length === 1 ? '' : 's'} to make`
            : 'No decisions needed'
        }
        description={
          questions.length > 0
            ? 'Every question below was raised by a specific finding — its cause is shown with it.'
            : 'The planner found nothing ambiguous, so there is nothing to answer before migrating.'
        }
        actions={
          <Button variant="ghost" onClick={goToPlan}>
            Back to plan
          </Button>
        }
      />

      {questions.length === 0 ? (
        <Panel>
          <div className="flex flex-col items-center py-8 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-pos/15 text-pos">
              <CheckIcon className="text-[20px]" />
            </span>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-2">
              The planner generated no decisions for this project — nothing is
              ambiguous or unsupported. You can start the migration directly.
            </p>
          </div>
        </Panel>
      ) : (
        <div className="space-y-4">
          {visibleQuestions.map((q) => (
            <QuestionCard
              key={q.id}
              question={q}
              steps={steps}
              selected={answers[q.id]}
              onSelect={(oid) => setAnswer(q.id, oid)}
            />
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger/8 px-3.5 py-3 text-[13px] text-danger">
          <AlertIcon className="mt-0.5 shrink-0 text-[16px]" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <span className="text-[13px] text-ink-3">
          {questions.length > 0 && unanswered.length > 0
            ? `${unanswered.length} required decision${unanswered.length === 1 ? '' : 's'} left`
            : 'Ready to migrate'}
        </span>
        <Button variant="primary" onClick={submit} disabled={!canSubmit}>
          {submitting ? 'Starting migration…' : 'Start migration'}
          <ArrowRightIcon className="text-[16px]" />
        </Button>
      </div>
    </div>
  )
}

function QuestionCard({
  question,
  steps,
  selected,
  onSelect,
}: {
  question: Question
  steps: MigrationPlan['steps']
  selected: string | undefined
  onSelect: (optionId: string) => void
}) {
  const affects = (steps ?? [])
    .filter((s) => (s.affectedByQuestions ?? []).includes(question.id))
    .map((s) => s.kind)
  const uniqueAffects = Array.from(new Set(affects))

  return (
    <Panel testId="ask-question" title={question.title}>
      {/* The finding that justified the question — non-negotiable. */}
      <div className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-0 px-3.5 py-2.5">
        <span className="mt-0.5 font-mono text-[11.5px] tracking-widest text-ink-4">
          WHY
        </span>
        <div>
          <p className="text-[13px] leading-relaxed text-ink-2">{question.context}</p>
          {uniqueAffects.length > 0 && (
            <p className="mt-1 text-[11.5px] text-ink-4">
              Affects: {uniqueAffects.join(' · ')}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {(question.options ?? []).map((o) => {
          const isSelected = selected === o.id
          return (
            <button
              key={o.id}
              onClick={() => onSelect(o.id)}
              data-testid="ask-option"
              className={cn(
                'flex flex-col rounded-lg border px-3.5 py-3 text-left transition-colors',
                isSelected
                  ? 'border-signal bg-signal/5'
                  : 'border-line bg-surface-0 hover:border-ink-4',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[15px] font-medium text-ink">{o.label}</span>
                <span className="flex items-center gap-1.5">
                  {o.isRecommended && <Badge tone="pos">recommended</Badge>}
                  <span
                    className={cn(
                      'h-4 w-4 shrink-0 rounded-full border-2',
                      isSelected ? 'border-signal bg-signal' : 'border-line-strong',
                    )}
                  />
                </span>
              </div>
              <p className="mt-1 text-[13px] text-ink-3">{o.description}</p>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-4">
                {o.tradeoffs}
              </p>
            </button>
          )
        })}
      </div>
    </Panel>
  )
}
