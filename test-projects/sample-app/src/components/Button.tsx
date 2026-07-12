import type { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost'
}

/** Reusable button with hover states (intentionally hard to convert to RN). */
export default function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonProps) {
  const base =
    'rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40'
  const variants = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-500',
    ghost: 'bg-transparent text-indigo-600 hover:bg-indigo-50',
  }
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props} />
  )
}
