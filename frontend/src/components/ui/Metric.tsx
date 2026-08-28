import type { ReactNode } from 'react'

import { cn } from '../../lib/cn'
import type { Tone } from '../../lib/display'
import { formatScore } from '../../lib/display'
import { useCountUp } from '../../lib/useCountUp'

const TONE_TEXT: Record<Tone, string> = {
  signal: 'text-signal',
  pos: 'text-pos',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
  ai: 'text-ai',
  neutral: 'text-ink',
}

const TONE_BAR: Record<Tone, string> = {
  signal: 'bg-signal',
  pos: 'bg-pos',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
  ai: 'bg-ai',
  neutral: 'bg-ink-3',
}

interface ScoreMetricProps {
  label: ReactNode
  /**
   * 0–100 value; rendered large and counted up. `null` means the score was
   * never measured (an empty population) — it renders as "n/a" with an empty
   * track, never as a number and never as 0%.
   */
  value: number | null
  tone: Tone
  caption?: ReactNode
  /** Right slot in the label row — typically an info tooltip. */
  aside?: ReactNode
  /** Stable hook for tests; applied to the numeric value span. */
  testId?: string
}

/** A 0–100 axis (Coverage / Confidence): big mono readout + a baseline track. */
export function ScoreMetric({ label, value, tone, caption, aside, testId }: ScoreMetricProps) {
  // The hook must be called unconditionally (rules of hooks), so an unmeasured
  // score counts up from a 0 that is never rendered — the readout below
  // branches on `value`, not on the animated number.
  const animated = useCountUp(value ?? 0)
  const measured = value != null
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        {aside}
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span
          data-testid={testId}
          className={cn(
            'tnum text-[46px] leading-none font-semibold tracking-tight tabular-nums',
            TONE_TEXT[tone],
          )}
        >
          {measured ? formatScore(animated) : 'n/a'}
        </span>
        {measured && <span className="text-xl font-medium text-ink-4">%</span>}
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div
          className={cn('h-full rounded-full transition-[width] duration-700 ease-out', TONE_BAR[tone])}
          style={{ width: measured ? `${Math.max(0, Math.min(100, animated))}%` : '0%' }}
        />
      </div>
      {caption && (
        <p className="mt-3 text-[13px] leading-relaxed text-ink-3">{caption}</p>
      )}
    </div>
  )
}

interface LevelMetricProps {
  label: ReactNode
  /** 0-based index of the active segment. */
  activeIndex: number
  segments: string[]
  tone: Tone
  valueLabel: ReactNode
  caption?: ReactNode
  aside?: ReactNode
  /** Stable hook for tests; applied to the value label span. */
  testId?: string
}

/**
 * A categorical axis (Risk): a discrete segmented gauge, deliberately NOT a
 * percentage — the whole point is that Risk is a different kind of number.
 */
export function LevelMetric({
  label,
  activeIndex,
  segments,
  tone,
  valueLabel,
  caption,
  aside,
  testId,
}: LevelMetricProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        {aside}
      </div>
      <div className="mt-3">
        <span
          data-testid={testId}
          className={cn('text-[34px] leading-none font-semibold tracking-tight', TONE_TEXT[tone])}
        >
          {valueLabel}
        </span>
      </div>
      <div className="mt-4 flex gap-1.5">
        {segments.map((seg, i) => (
          <div key={seg} className="flex-1">
            <div
              className={cn(
                'h-1.5 rounded-full',
                i === activeIndex ? TONE_BAR[tone] : 'bg-surface-3',
              )}
            />
          </div>
        ))}
      </div>
      {caption && (
        <p className="mt-3 text-[13px] leading-relaxed text-ink-3">{caption}</p>
      )}
    </div>
  )
}

interface StatProps {
  label: ReactNode
  value: ReactNode
}

/** A compact project-summary tile: large mono figure + small label. */
export function Stat({ label, value }: StatProps) {
  return (
    <div className="rounded-xl border border-line bg-surface-0 px-4 py-3.5">
      <div className="tnum text-2xl font-semibold tracking-tight text-ink tabular-nums">
        {value}
      </div>
      <div className="eyebrow mt-1.5">{label}</div>
    </div>
  )
}
