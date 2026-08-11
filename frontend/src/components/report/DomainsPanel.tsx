import { Badge } from '../ui/Badge'
import { Panel } from '../ui/Panel'
import { RISK_LABEL, RISK_TONE } from '../../lib/display'
import type { DomainRisk } from '../../types/api'

export function DomainsPanel({ domains }: { domains: DomainRisk[] }) {
  return (
    <Panel
      eyebrow="Functional domains"
      title="Domains & risk"
      description="What the project actually does — detected from graph evidence, each with its migration risk."
      actions={
        <span className="font-mono text-[13px] text-ink-3 tabular-nums">
          {domains.length} detected
        </span>
      }
    >
      {domains.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-ink-3">
          No high-signal functional domains detected.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {domains.map((d) => (
            <div
              key={d.domain}
              className="flex flex-col rounded-xl border border-line bg-surface-0 p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[15px] font-medium text-ink capitalize">
                  {d.domain}
                </span>
                <Badge tone={RISK_TONE[d.risk]} dot>
                  {RISK_LABEL[d.risk]} risk
                </Badge>
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
                {d.reason}
              </p>
              {d.rnNotes && (
                <p className="mt-2 border-t border-line/60 pt-2 text-[13px] leading-relaxed text-ink-3">
                  <span className="font-mono text-[11.5px] tracking-wide text-ink-4">
                    RN&nbsp;·&nbsp;
                  </span>
                  {d.rnNotes}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
