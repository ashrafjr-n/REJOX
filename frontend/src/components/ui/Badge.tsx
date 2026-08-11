import type { ReactNode } from 'react'

import { cn } from '../../lib/cn'
import type { Tone } from '../../lib/display'

interface BadgeProps {
  tone?: Tone
  /** Prefix a small filled dot — reads like a status LED. */
  dot?: boolean
  children: ReactNode
  className?: string
}

/** Soft-tinted status pill. The one place status color is allowed to speak. */
const TONE_CLASS: Record<Tone, string> = {
  signal: 'text-signal bg-signal/10 ring-signal/25',
  pos: 'text-pos bg-pos/10 ring-pos/25',
  warn: 'text-warn bg-warn/10 ring-warn/25',
  danger: 'text-danger bg-danger/10 ring-danger/25',
  info: 'text-info bg-info/10 ring-info/25',
  ai: 'text-ai bg-ai/10 ring-ai/25',
  neutral: 'text-ink-2 bg-surface-3 ring-line-strong',
}

const DOT_CLASS: Record<Tone, string> = {
  signal: 'bg-signal',
  pos: 'bg-pos',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
  ai: 'bg-ai',
  neutral: 'bg-ink-3',
}

export function Badge({ tone = 'neutral', dot, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        // Pill, like every chip on the marketing pages.
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ring-1 ring-inset whitespace-nowrap',
        TONE_CLASS[tone],
        className,
      )}
    >
      {dot && (
        <span className={cn('h-1.5 w-1.5 rounded-full', DOT_CLASS[tone])} />
      )}
      {children}
    </span>
  )
}
