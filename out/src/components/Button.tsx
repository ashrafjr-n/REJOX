import { Pressable, PressableProps } from 'react-native';

// ===== REJOX-TODO: 1 item(s) need attention =====
// REJOX-TODO(PROPS_TYPE_MAPPED): ButtonHTMLAttributes → PressableProps on interface ButtonProps (DOM props become RN props).

interface ButtonProps extends PressableProps {
  variant?: 'primary' | 'ghost'
}

/** Reusable button with hover states (intentionally hard to convert to RN). */
export default function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonProps) {
  const base =
    'rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40'
  const variants = {
    primary: 'bg-indigo-600 text-white active:bg-indigo-500',
    ghost: 'bg-transparent text-indigo-600 active:bg-indigo-50',
  }
  return (
    <Pressable className={`${base} ${variants[variant]} ${className}`} {...props} />
  )
}
