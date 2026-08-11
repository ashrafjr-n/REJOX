import { Panel } from '../ui/Panel'
import { SEVERITY_TONE } from '../../lib/display'
import type { Issue } from '../../types/api'

const DOT: Record<string, string> = {
  info: 'bg-info',
  warn: 'bg-warn',
  danger: 'bg-danger',
}

function IssueRow({ issue }: { issue: Issue }) {
  const tone = SEVERITY_TONE[issue.severity]
  return (
    <li className="flex gap-3 px-5 py-3">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[tone]}`} />
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-ink">
            {issue.message}
          </span>
          <span className="font-mono text-[11.5px] tracking-wide text-ink-4">
            {issue.code}
          </span>
        </div>
        <div className="text-[13px] leading-snug text-ink-3">
          {issue.evidence.file && (
            <span className="font-mono text-ink-4">
              {issue.evidence.file} ·{' '}
            </span>
          )}
          {issue.evidence.detail}
        </div>
      </div>
    </li>
  )
}

export function FindingsPanel({
  blockers,
  warnings,
}: {
  blockers: Issue[]
  warnings: Issue[]
}) {
  const issues = [...blockers, ...warnings]
  if (issues.length === 0) return null

  return (
    <Panel
      eyebrow="Findings"
      title="Blockers & warnings"
      actions={
        <div className="flex items-center gap-3 font-mono text-[13px] tabular-nums">
          {blockers.length > 0 && (
            <span className="text-danger">{blockers.length} blocking</span>
          )}
          <span className="text-warn">{warnings.length} warning</span>
        </div>
      }
      flush
    >
      <ul className="divide-y divide-line/60">
        {issues.map((issue, i) => (
          <IssueRow key={`${issue.code}-${i}`} issue={issue} />
        ))}
      </ul>
    </Panel>
  )
}
