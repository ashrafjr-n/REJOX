import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { cn } from '../../lib/cn'

interface TooltipProps {
  content: ReactNode
  children: ReactNode
  className?: string
  /** Max width of the bubble in px. */
  width?: number
}

/**
 * Lightweight hover/focus tooltip. Used to explain the Coverage vs Confidence
 * distinction inline, without a modal. Accessible via keyboard focus.
 */
export function Tooltip({ content, children, className, width = 260 }: TooltipProps) {
  const [open, setOpen] = useState(false)
  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
    >
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            style={{ width }}
            className="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 rounded-xl border border-line-strong bg-surface-2 px-3 py-2.5 text-[13px] leading-relaxed text-ink-2 shadow-[0_12px_32px_-8px_rgb(0_0_0/0.7)]"
          >
            {content}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}
