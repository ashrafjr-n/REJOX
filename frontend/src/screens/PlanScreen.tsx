import { useEffect, useMemo, useState } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
} from 'reactflow'
import type { Edge, Node } from 'reactflow'
import 'reactflow/dist/style.css'

import { ApiError, plan as fetchPlan } from '../api/rejox'
import { PlanNode } from '../components/plan/PlanNode'
import type { PlanNodeData } from '../components/plan/PlanNode'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Panel } from '../components/ui/Panel'
import { AlertIcon, ArrowRightIcon } from '../components/icons'
import { cn } from '../lib/cn'
import {
  findingsForStep,
  groupByWave,
  positionOf,
  stepIsFlagged,
} from '../lib/planGraph'
import { EFFORT_TONE, STEP_KIND_TONE } from '../lib/display'
import { usePipelineStore } from '../store/pipelineStore'
import type { MigrationPlan, PlanStep, Severity, SourceRequest } from '../types/api'

const NODE_TYPES = { planStep: PlanNode }

/** Finding severity → literal text color class (kept static for Tailwind JIT). */
const SEVERITY_TEXT: Record<Severity, string> = {
  info: 'text-info',
  warning: 'text-warn',
  blocker: 'text-danger',
}

export function PlanScreen() {
  const ingest = usePipelineStore((s) => s.ingest)
  const selectedRoot = usePipelineStore((s) => s.selectedRoot)
  const plan = usePipelineStore((s) => s.plan)
  const setPlan = usePipelineStore((s) => s.setPlan)
  const goToAsk = usePipelineStore((s) => s.goToAsk)
  const reset = usePipelineStore((s) => s.reset)

  const [error, setError] = useState<string | null>(null)

  // Fetch the plan once (parse + analyze + plan) if we don't have it yet.
  useEffect(() => {
    if (!ingest) {
      reset()
      return
    }
    if (plan) return
    let cancelled = false
    const source: SourceRequest = selectedRoot
      ? { runId: ingest.runId, root: selectedRoot }
      : { runId: ingest.runId }
    fetchPlan(source)
      .then((res) => {
        if (!cancelled) setPlan(res.plan)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Planning failed.')
      })
    return () => {
      cancelled = true
    }
  }, [ingest, selectedRoot, plan, setPlan, reset])

  if (error) {
    return (
      <div className="mx-auto max-w-lg pt-10">
        <div className="rounded-xl border border-danger/30 bg-danger/8 p-6 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-danger/15 text-danger">
            <AlertIcon className="text-[20px]" />
          </span>
          <h2 className="mt-4 text-[15px] font-semibold text-ink">Planning failed</h2>
          <p className="mx-auto mt-2 max-w-sm text-[13px] text-ink-2">{error}</p>
          <div className="mt-5 flex justify-center">
            <Button variant="secondary" onClick={reset}>
              Back to upload
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!plan) {
    return (
      <div className="flex flex-col items-center pt-24 text-center">
        <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-signal/20 border-t-signal" />
        <div className="eyebrow mt-5">Stage 04 · Plan</div>
        <p className="mt-2 text-[14px] text-ink-2">
          Ordering the migration into dependency waves…
        </p>
      </div>
    )
  }

  return <PlanView plan={plan} onContinue={goToAsk} onReset={reset} />
}

function PlanView({
  plan,
  onContinue,
  onReset,
}: {
  plan: MigrationPlan
  onContinue: () => void
  onReset: () => void
}) {
  const steps = useMemo(() => plan.steps ?? [], [plan.steps])
  const candidates = useMemo(
    () => plan.manualReviewCandidates ?? [],
    [plan.manualReviewCandidates],
  )
  const questions = plan.questions ?? []
  const unsupported = plan.unsupportedItems ?? []

  // Waves come straight from the backend (step.wave) — no recomputation here.
  const { waves } = useMemo(() => groupByWave(steps), [steps])

  const { nodes, edges } = useMemo(() => {
    const nodes: Node<PlanNodeData>[] = []
    waves.forEach((wave, waveIndex) => {
      wave.forEach((step, rowIndex) => {
        nodes.push({
          id: step.id,
          type: 'planStep',
          position: positionOf(waveIndex, rowIndex),
          data: {
            step,
            findingCount: findingsForStep(step).length,
            gated: (step.affectedByQuestions ?? []).length > 0,
          },
        })
      })
    })
    const edges: Edge[] = []
    for (const step of steps) {
      for (const dep of step.dependsOn ?? []) {
        edges.push({
          id: `${dep}->${step.id}`,
          source: dep,
          target: step.id,
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-line-strong)' },
          style: { stroke: 'var(--color-line-strong)', strokeWidth: 1.5 },
        })
      }
    }
    return { nodes, edges }
  }, [waves, steps])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = steps.find((s) => s.id === selectedId) ?? null

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-2">Stage 04 · Migration Plan</div>
          <h1 className="text-[24px] font-semibold tracking-tight text-ink">
            {steps.length} steps, {waves.length} dependency waves
          </h1>
          <p className="mt-1.5 text-[13.5px] text-ink-3">
            Ordered leaves → composites → pages. Flagged nodes are gated by a
            decision or carry a manual-review finding.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onReset}>
            New analysis
          </Button>
          <Button variant="primary" onClick={onContinue}>
            {questions.length > 0 ? 'Continue to decisions' : 'Continue'}
            <ArrowRightIcon className="text-[16px]" />
          </Button>
        </div>
      </header>

      {/* Wave legend — the ordering, legible at a glance and countable. */}
      <div className="flex flex-wrap gap-2">
        {waves.map((wave, i) => (
          <div
            key={i}
            data-testid="plan-wave"
            className="flex items-center gap-2 rounded-md border border-line bg-surface-0 px-2.5 py-1"
          >
            <span className="font-mono text-[10px] tracking-widest text-signal">
              W{i + 1}
            </span>
            <span className="text-[11.5px] text-ink-3">
              {wave.length} step{wave.length === 1 ? '' : 's'}
            </span>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* The DAG */}
        <div className="h-[560px] overflow-hidden rounded-xl border border-line bg-surface-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.2}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--color-line)" />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              maskColor="rgba(0,0,0,0.6)"
              style={{ background: 'var(--color-surface-1)' }}
              nodeColor="var(--color-surface-3)"
            />
          </ReactFlow>
        </div>

        {/* Side panel — details of the selected node (real plan fields only). */}
        <div className="lg:h-[560px] lg:overflow-y-auto">
          {selected ? (
            <StepDetail step={selected} />
          ) : (
            <Panel title="Inspect a step" className="h-full">
              <p className="text-[13px] leading-relaxed text-ink-3">
                Select any node to see its targets, dependencies, findings, and
                the decisions that gate it — straight from the planner.
              </p>
            </Panel>
          )}
        </div>
      </div>

      {(candidates.length > 0 || unsupported.length > 0) && (
        <div className="grid gap-5 lg:grid-cols-2">
          {candidates.length > 0 && (
            <Panel
              eyebrow="Findings"
              title="Manual review"
              actions={
                <span className="font-mono text-[12px] text-ink-3 tabular-nums">
                  {candidates.length}
                </span>
              }
            >
              <ul className="space-y-2.5">
                {candidates.map((c) => (
                  <li key={c.componentId} className="text-[12.5px]">
                    <div className="font-mono text-[11.5px] text-ink-2">
                      {c.componentId}
                    </div>
                    <div className="text-ink-3">{c.reason}</div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {unsupported.length > 0 && (
            <Panel eyebrow="Findings" title="Unsupported">
              <ul className="space-y-2.5">
                {unsupported.map((u) => (
                  <li key={u.name} className="text-[12.5px]">
                    <div className="font-medium text-ink">{u.name}</div>
                    <div className="text-ink-3">{u.reason}</div>
                    <div className="mt-0.5 text-ink-4">{u.suggestion}</div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </div>
  )
}

function StepDetail({ step }: { step: PlanStep }) {
  const targets = step.targets ?? []
  const deps = step.dependsOn ?? []
  const gates = step.affectedByQuestions ?? []
  const findings = findingsForStep(step)
  const flagged = stepIsFlagged(step)

  return (
    <Panel
      eyebrow={
        <>
          Step #{step.order} · {step.id}
        </>
      }
      title={step.title}
      className="h-full"
    >
      <div className="flex items-center gap-2">
        <Badge tone={STEP_KIND_TONE[step.kind]} dot>
          {step.kind}
        </Badge>
        <Badge tone={EFFORT_TONE[step.estimatedEffort]}>
          {step.estimatedEffort} effort
        </Badge>
        {flagged && <Badge tone="warn">needs attention</Badge>}
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
        {step.description}
      </p>

      {step.notes && (
        <p className="mt-3 rounded-md border border-line bg-surface-0 px-3 py-2 text-[12px] leading-relaxed text-ink-3">
          {step.notes}
        </p>
      )}

      {gates.length > 0 && (
        <Section title="Gated by decisions">
          <div className="flex flex-wrap gap-1.5">
            {gates.map((q) => (
              <Badge key={q} tone="signal" dot>
                {q}
              </Badge>
            ))}
          </div>
        </Section>
      )}

      {findings.length > 0 && (
        <Section title={`Findings (${findings.length})`}>
          <ul className="space-y-1.5">
            {findings.map((f, i) => (
              <li key={`${f.componentId}-${f.code}-${i}`} className="flex gap-2 text-[12px]">
                <AlertIcon
                  className={cn('mt-0.5 shrink-0 text-[13px]', SEVERITY_TEXT[f.severity])}
                />
                <span className="min-w-0">
                  <span className="font-mono text-[10.5px] text-ink-4">{f.code}</span>{' '}
                  <span className="text-ink-2">{f.message}</span>
                  <span className="block truncate font-mono text-[10.5px] text-ink-4">
                    {f.componentId}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {deps.length > 0 && (
        <Section title={`Depends on (${deps.length})`}>
          <div className="flex flex-wrap gap-1.5">
            {deps.map((d) => (
              <span
                key={d}
                className="rounded border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-2"
              >
                {d}
              </span>
            ))}
          </div>
        </Section>
      )}

      <Section title={`Targets (${targets.length})`}>
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {targets.map((t) => (
            <li key={t} className="truncate font-mono text-[11px] text-ink-3" title={t}>
              {t}
            </li>
          ))}
        </ul>
      </Section>
    </Panel>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={cn('mt-4 border-t border-line/60 pt-3')}>
      <div className="eyebrow mb-2">{title}</div>
      {children}
    </div>
  )
}
