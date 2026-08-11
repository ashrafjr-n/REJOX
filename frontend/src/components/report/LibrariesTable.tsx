import { Badge } from '../ui/Badge'
import { Panel } from '../ui/Panel'
import { Table } from '../ui/Table'
import type { Column } from '../ui/Table'
import { cn } from '../../lib/cn'
import { LIBRARY_STATUS_LABEL, LIBRARY_STATUS_TONE } from '../../lib/display'
import type { LibraryFinding } from '../../types/api'

function CompatibilityBar({ value }: { value: number }) {
  const tone =
    value >= 80 ? 'bg-pos' : value >= 50 ? 'bg-warn' : 'bg-danger'
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-3">
        <div
          className={cn('h-full rounded-full', tone)}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
      <span className="tnum w-8 text-right font-mono text-[13px] text-ink-2 tabular-nums">
        {value}
      </span>
    </div>
  )
}

const columns: Column<LibraryFinding>[] = [
  {
    key: 'name',
    header: 'Library',
    render: (lib) => (
      <div className="flex items-center gap-2">
        <span className="font-medium text-ink">{lib.name}</span>
        {lib.version && (
          <span className="font-mono text-[11.5px] text-ink-4">{lib.version}</span>
        )}
      </div>
    ),
  },
  {
    key: 'category',
    header: 'Category',
    render: (lib) => (
      <span className="font-mono text-[11.5px] text-ink-3">{lib.category}</span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (lib) => (
      <Badge tone={LIBRARY_STATUS_TONE[lib.status]} dot>
        {LIBRARY_STATUS_LABEL[lib.status]}
      </Badge>
    ),
  },
  {
    key: 'rn',
    header: 'RN equivalent',
    render: (lib) =>
      (lib.rnEquivalents ?? []).length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {(lib.rnEquivalents ?? []).map((rn) => (
            <span
              key={rn.name}
              title={rn.note || undefined}
              className="rounded border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[11.5px] text-ink-2"
            >
              {rn.name}
            </span>
          ))}
        </div>
      ) : (
        <span className="text-ink-4">—</span>
      ),
  },
  {
    key: 'compat',
    header: 'Compatibility',
    align: 'right',
    width: 'w-40',
    render: (lib) => <CompatibilityBar value={lib.compatibility} />,
  },
]

export function LibrariesTable({ libraries }: { libraries: LibraryFinding[] }) {
  return (
    <Panel
      eyebrow="Dependencies"
      title="Libraries"
      description="Each dependency mapped to its React Native standing and equivalent."
      actions={
        <span className="font-mono text-[13px] text-ink-3 tabular-nums">
          {libraries.length} detected
        </span>
      }
      flush
    >
      <Table
        columns={columns}
        data={libraries}
        getRowKey={(lib) => lib.name}
        empty="No third-party libraries detected."
      />
    </Panel>
  )
}
