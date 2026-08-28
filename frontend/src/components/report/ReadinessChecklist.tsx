import { motion, useReducedMotion } from 'framer-motion'

import { Panel } from '../ui/Panel'
import { AlertIcon, CheckIcon, InfoIcon } from '../icons'
import { cn } from '../../lib/cn'
import { LIBRARY_STATUS_LABEL, RISK_LABEL, formatScorePercent } from '../../lib/display'
import { rowEntry } from '../../lib/motion'
import type {
  AnalysisReport,
  LibraryCategory,
  LibraryFinding,
  LibraryStatus,
  MigrationPlan,
} from '../../types/api'
import type { PipelineState } from '../../store/pipelineStore'

type PlanStatus = PipelineState['planStatus']

/**
 * The Review step's lead: "is this project ready to migrate?", answerable in a
 * glance. Everything here is derived from the analysis response the screen
 * already holds — no new backend fields.
 *
 * The supported / needs-a-human split is `LibraryFinding.status`, the backend's
 * own enum, read the same way the Libraries table reads it:
 *
 *   compatible       → runs unchanged                        ✓
 *   needs-conversion → a mapped RN equivalent exists; the    ✓
 *                      deterministic transformer does it
 *   partial          → only partially mappable               ⚠ manual review
 *   unknown          → never guessed by the detector         ⚠ manual review
 *   unsupported      → out of scope; the backend also emits  ⚠ blocker
 *                      a `blocker` Issue for it
 *
 * Density is the enemy of a three-second read, so only libraries that actually
 * change the migration get their own line; the rest are counted on one line and
 * every last detail stays in the full analysis below.
 */

/** Statuses that mean a human has to look at it. */
const MANUAL_REVIEW: LibraryStatus[] = ['partial', 'unknown']
/** Categories where the library choice actually shapes the migration. */
const DECISIVE: LibraryCategory[] = [
  'routing',
  'state',
  'styling',
  'animation',
  'ui',
  'http',
]
/** Above this, extra library lines collapse into a "+N more" tail. */
const MAX_LIBRARY_LINES = 5
/** Names listed inline on the grouped line before it, too, says "+N more". */
const MAX_INLINE_NAMES = 5

type Glyph = 'ok' | 'warn' | 'block' | 'pending'

interface CheckLine {
  id: string
  glyph: Glyph
  label: string
  detail?: string
}

const GLYPH_CLASS: Record<Glyph, string> = {
  ok: 'border-pos/40 bg-pos/12 text-pos',
  warn: 'border-warn/40 bg-warn/12 text-warn',
  block: 'border-danger/40 bg-danger/12 text-danger',
  pending: 'border-line-strong bg-surface-2 text-ink-3',
}

const VERDICT_CLASS: Record<Glyph, string> = {
  ok: 'border-pos/30 bg-pos/8',
  warn: 'border-warn/30 bg-warn/8',
  block: 'border-danger/30 bg-danger/8',
  pending: 'border-line bg-surface-2/50',
}

/** `unsupported` first, then the manual-review statuses, then the rest. */
const STATUS_WEIGHT: Record<LibraryStatus, number> = {
  unsupported: 0,
  partial: 1,
  unknown: 2,
  'needs-conversion': 3,
  compatible: 4,
}

function glyphFor(status: LibraryStatus): Glyph {
  if (status === 'unsupported') return 'block'
  return MANUAL_REVIEW.includes(status) ? 'warn' : 'ok'
}

/** A library only earns its own line if it needs a human or changes the plan. */
function earnsOwnLine(lib: LibraryFinding): boolean {
  if (lib.status === 'unsupported' || MANUAL_REVIEW.includes(lib.status)) {
    return true
  }
  return lib.status === 'needs-conversion' && DECISIVE.includes(lib.category)
}

function joinNames(names: string[], max = MAX_INLINE_NAMES): string {
  if (names.length <= max) return names.join(' · ')
  return `${names.slice(0, max).join(' · ')} · +${names.length - max} more`
}

function libraryLine(lib: LibraryFinding): CheckLine {
  const rn = (lib.rnEquivalents ?? []).map((e) => e.name)
  const mapped = rn.length > 0 ? ` → ${rn.join(' / ')}` : ''
  return {
    id: `lib-${lib.name}`,
    glyph: glyphFor(lib.status),
    label: `${lib.name}${mapped}`,
    detail: lib.notes ?? LIBRARY_STATUS_LABEL[lib.status],
  }
}

function buildLines(report: AnalysisReport): CheckLine[] {
  const libraries = report.libraries ?? []
  const s = report.summary

  const own = libraries
    .filter(earnsOwnLine)
    .sort((a, b) => STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status])
  const shown = own.slice(0, MAX_LIBRARY_LINES)
  const overflow = own.length - shown.length
  const grouped = libraries.filter((l) => !earnsOwnLine(l))

  const lines: CheckLine[] = shown.map(libraryLine)

  if (overflow > 0) {
    lines.push({
      id: 'lib-overflow',
      glyph: 'warn',
      label: `+${overflow} more libraries need attention`,
      detail: 'Listed in the full analysis below.',
    })
  }

  if (grouped.length > 0) {
    lines.push({
      id: 'lib-clean',
      glyph: 'ok',
      label: `${grouped.length} ${grouped.length === 1 ? 'library carries' : 'libraries carry'} over automatically`,
      detail: joinNames(grouped.map((l) => l.name)),
    })
  }

  // One structural line — routes and components read naturally as a check; the
  // remaining counts ride along as its detail rather than becoming rows.
  if (s.componentCount > 0 || s.routeCount > 0) {
    lines.push({
      id: 'structure',
      glyph: 'ok',
      label: `${s.routeCount} routes · ${s.componentCount} components detected`,
      detail: `${s.pageCount} pages · ${s.apiEndpointCount} API endpoints · ${s.storeCount} ${s.storeCount === 1 ? 'store' : 'stores'}`,
    })
  }

  return lines
}

function buildVerdict(
  report: AnalysisReport,
  plan: MigrationPlan | null,
  planStatus: PlanStatus,
): CheckLine {
  const libraries = report.libraries ?? []
  const blockers = report.blockers ?? []
  const unsupported = libraries.filter((l) => l.status === 'unsupported')
  const manual = libraries.filter((l) => MANUAL_REVIEW.includes(l.status))
  const questions = plan?.questions ?? []

  // The plan is prefetched during the analysis reveal, so it is normally here
  // before this screen mounts. If it is still in flight we say so rather than
  // publish a verdict that would change under the reader a second later.
  if (!plan && planStatus === 'loading') {
    return {
      id: 'verdict',
      glyph: 'pending',
      label: 'Checking whether any decisions are needed…',
      detail: 'Reading the migration plan.',
    }
  }

  if (blockers.length > 0) {
    return {
      id: 'verdict',
      glyph: 'block',
      label: `${blockers.length} ${blockers.length === 1 ? 'blocker' : 'blockers'} must be resolved before migrating`,
      detail:
        unsupported.length > 0
          ? `Unsupported: ${joinNames(unsupported.map((l) => l.name))}`
          : blockers[0].message,
    }
  }

  if (questions.length > 0) {
    return {
      id: 'verdict',
      glyph: 'warn',
      label: `${questions.length} ${questions.length === 1 ? 'decision is' : 'decisions are'} needed next`,
      detail: 'Answered on the Decisions step, before anything is migrated.',
    }
  }

  if (manual.length > 0) {
    return {
      id: 'verdict',
      glyph: 'warn',
      label: `${manual.length} ${manual.length === 1 ? 'library needs' : 'libraries need'} manual review — nothing blocks migration`,
      detail: joinNames(manual.map((l) => l.name)),
    }
  }

  return {
    id: 'verdict',
    glyph: 'ok',
    label: 'Ready to migrate',
    detail: 'No blockers, and every dependency has a React Native path.',
  }
}

function Glyph({ glyph }: { glyph: Glyph }) {
  return (
    <span
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border',
        GLYPH_CLASS[glyph],
      )}
      aria-hidden="true"
    >
      {glyph === 'ok' ? (
        <CheckIcon className="text-[15px]" />
      ) : glyph === 'pending' ? (
        <InfoIcon className="text-[13px]" />
      ) : (
        <AlertIcon className="text-[13px]" />
      )}
    </span>
  )
}

/** Screen-reader text for the glyph, so the status is never colour-only. */
const GLYPH_LABEL: Record<Glyph, string> = {
  ok: 'OK:',
  warn: 'Needs review:',
  block: 'Blocked:',
  pending: 'Pending:',
}

export function ReadinessChecklist({
  report,
  plan,
  planStatus,
}: {
  report: AnalysisReport
  plan: MigrationPlan | null
  planStatus: PlanStatus
}) {
  const reduceMotion = useReducedMotion() === true
  const lines = buildLines(report)
  const verdict = buildVerdict(report, plan, planStatus)
  const warnings = report.warnings ?? []

  const row = (i: number) => rowEntry(i, reduceMotion)

  return (
    <Panel
      testId="readiness-checklist"
      eyebrow="Readiness"
      title="Is this project ready to migrate?"
      description="The short answer, from the analysis. Every number behind it is in the full analysis below."
      flush
    >
      <ul>
        {lines.map((line, i) => (
          <motion.li
            key={line.id}
            data-testid="checklist-row"
            data-glyph={line.glyph}
            {...row(i)}
            className="flex items-center gap-3 border-b border-line/60 px-5 py-2.5"
          >
            <Glyph glyph={line.glyph} />
            <span className="sr-only">{GLYPH_LABEL[line.glyph]}</span>
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3">
              <span className="text-[15px] font-medium text-ink">
                {line.label}
              </span>
              {line.detail && (
                <span className="truncate font-mono text-[11.5px] text-ink-4">
                  {line.detail}
                </span>
              )}
            </div>
          </motion.li>
        ))}

        <motion.li
          data-testid="checklist-verdict"
          data-glyph={verdict.glyph}
          {...row(lines.length)}
          className={cn(
            'flex items-center gap-3 border-t border-line px-5 py-3.5',
            VERDICT_CLASS[verdict.glyph],
          )}
        >
          <Glyph glyph={verdict.glyph} />
          <span className="sr-only">{GLYPH_LABEL[verdict.glyph]}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-ink">
              {verdict.label}
            </div>
            {verdict.detail && (
              <div className="mt-0.5 truncate font-mono text-[11.5px] text-ink-3">
                {verdict.detail}
              </div>
            )}
          </div>
        </motion.li>
      </ul>

      {/* The three axes as one quiet line — the pointer into the detail, not a
          second readout competing with the checklist. */}
      <motion.p
        {...row(lines.length + 1)}
        className="border-t border-line/60 px-5 py-2.5 font-mono text-[11.5px] tracking-wide text-ink-4"
      >
        Coverage {formatScorePercent(report.coverage)} · Confidence{' '}
        {formatScorePercent(report.confidence)} · Risk {RISK_LABEL[report.risk]} ·{' '}
        {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}
      </motion.p>
    </Panel>
  )
}
