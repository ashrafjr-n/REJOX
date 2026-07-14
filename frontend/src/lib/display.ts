/**
 * Presentation helpers: map backend enums to visual tones + labels, and
 * format the raw numbers the API returns. Pure, no side effects.
 */
import type {
  Difficulty,
  LibraryStatus,
  RiskLevel,
  Severity,
} from '../types/api'

/** The semantic tones our Badge/Metric primitives understand. */
export type Tone =
  | 'signal'
  | 'pos'
  | 'warn'
  | 'danger'
  | 'info'
  | 'ai'
  | 'neutral'

export const LIBRARY_STATUS_TONE: Record<LibraryStatus, Tone> = {
  compatible: 'pos',
  'needs-conversion': 'info',
  partial: 'warn',
  unsupported: 'danger',
  unknown: 'neutral',
}

export const LIBRARY_STATUS_LABEL: Record<LibraryStatus, string> = {
  compatible: 'Compatible',
  'needs-conversion': 'Needs conversion',
  partial: 'Partial',
  unsupported: 'Unsupported',
  unknown: 'Unknown',
}

export const RISK_TONE: Record<RiskLevel, Tone> = {
  low: 'pos',
  medium: 'warn',
  high: 'danger',
}

export const RISK_LABEL: Record<RiskLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export const SEVERITY_TONE: Record<Severity, Tone> = {
  info: 'info',
  warning: 'warn',
  blocker: 'danger',
}

export const DIFFICULTY_TONE: Record<Difficulty, Tone> = {
  trivial: 'pos',
  easy: 'pos',
  medium: 'warn',
  hard: 'warn',
  blocked: 'danger',
}

/** Human-readable byte size, e.g. 1536000 → "1.5 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 || Number.isInteger(value) ? 0 : 1)} ${units[unit]}`
}

/** Round a 0–100 score for display, dropping a trailing ".0". */
export function formatScore(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

/** Signed delta for the score breakdown, e.g. +40 / −4. Uses a real minus. */
export function formatDelta(value: number): string {
  const rounded = Math.round(value * 10) / 10
  const abs = Number.isInteger(rounded)
    ? String(Math.abs(rounded))
    : Math.abs(rounded).toFixed(1)
  return rounded < 0 ? `−${abs}` : `+${abs}`
}
