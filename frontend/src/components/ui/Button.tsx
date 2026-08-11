import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { cn } from '../../lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  children: ReactNode
}

/**
 * The home page's button language: everything is a pill. `primary` is the
 * Login / Start-migration treatment (white fill, black label, soft silver
 * glow); `secondary` is the nav-item pill (nav-item-bg fill, silver label,
 * inverting to light-silver on hover); `ghost` is the same pill with no fill
 * until you touch it.
 */
const VARIANT_CLASS: Record<Variant, string> = {
  primary:
    'bg-signal text-void font-semibold hover:bg-ink-2 shadow-[0_6px_18px_rgba(201,201,206,0.35)] hover:shadow-[0_8px_24px_rgba(201,201,206,0.55)]',
  secondary:
    'bg-surface-2 text-ink-2 hover:bg-ink-2 hover:text-void',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
}

const SIZE_CLASS: Record<Size, string> = {
  sm: 'h-8 px-4 text-[13px] gap-1.5 rounded-full',
  md: 'h-10 px-5 text-[13px] gap-2 rounded-full',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-medium tracking-tight transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-signal/60 disabled:pointer-events-none disabled:opacity-45',
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
