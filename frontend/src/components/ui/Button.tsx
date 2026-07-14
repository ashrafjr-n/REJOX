import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { cn } from '../../lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  children: ReactNode
}

const VARIANT_CLASS: Record<Variant, string> = {
  primary:
    'bg-signal text-void font-semibold hover:bg-[color-mix(in_oklab,var(--color-signal)_88%,white)] shadow-[0_0_0_1px_var(--color-signal-deep),0_10px_24px_-10px_color-mix(in_oklab,var(--color-signal)_60%,transparent)]',
  secondary:
    'bg-surface-2 text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-3 hover:ring-ink-4',
  ghost: 'text-ink-2 hover:text-ink hover:bg-surface-2',
}

const SIZE_CLASS: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-md',
  md: 'h-10 px-4 text-sm gap-2 rounded-lg',
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
