import type { ReactNode } from 'react'

import { cn } from '../../lib/cn'

export interface Column<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  align?: 'left' | 'right'
  /** Tailwind width class, e.g. "w-48". Optional. */
  width?: string
  className?: string
}

interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
  getRowKey: (row: T, index: number) => string
  /** Rendered in place of an empty tbody. */
  empty?: ReactNode
}

/**
 * A data-driven table primitive. Column-config in, styled rows out — every
 * table in the report (libraries, routes…) is one of these, so they stay
 * visually identical. Scrolls horizontally inside its own container.
 */
export function Table<T>({ columns, data, getRowKey, empty }: TableProps<T>) {
  if (data.length === 0 && empty) {
    return <div className="px-5 py-8 text-center text-[13px] text-ink-3">{empty}</div>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'eyebrow px-5 py-2.5 font-medium whitespace-nowrap',
                  col.align === 'right' ? 'text-right' : 'text-left',
                  col.width,
                )}
                scope="col"
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={getRowKey(row, i)}
              className="border-b border-line/60 last:border-0 transition-colors hover:bg-surface-2/50"
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    'px-5 py-3 align-middle text-ink-2',
                    col.align === 'right' ? 'text-right' : 'text-left',
                    col.className,
                  )}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
