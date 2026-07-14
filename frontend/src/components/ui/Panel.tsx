import type { ReactNode } from 'react'

import { cn } from '../../lib/cn'

interface PanelProps {
  /** Small monospace label above the title, e.g. "SCORE · EXPLAINED". */
  eyebrow?: ReactNode
  title?: ReactNode
  /** One quiet line under the title — context, not decoration. */
  description?: ReactNode
  /** Right-aligned slot in the header (counts, controls). */
  actions?: ReactNode
  children?: ReactNode
  /** Drop the inner padding — for panels that wrap a full-bleed table. */
  flush?: boolean
  className?: string
}

/**
 * The base surface primitive. Everything sits on a Panel: a bordered, softly
 * shadowed card with an optional structured header.
 */
export function Panel({
  eyebrow,
  title,
  description,
  actions,
  children,
  flush,
  className,
}: PanelProps) {
  const hasHeader = eyebrow || title || description || actions
  return (
    <section
      className={cn(
        'rounded-xl border border-line bg-surface-1 shadow-[var(--shadow-panel)]',
        className,
      )}
    >
      {hasHeader && (
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
            {title && (
              <h2 className="text-[15px] font-semibold tracking-tight text-ink">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-ink-3">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cn(!flush && 'p-5')}>{children}</div>
    </section>
  )
}
