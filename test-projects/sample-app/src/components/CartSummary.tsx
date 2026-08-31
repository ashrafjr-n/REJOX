import { useCartStore } from '../store/cartStore'
import CartItem from './CartItem'
import Button from './Button'

interface CartSummaryProps {
  darkMode?: boolean
}

/** Renders the cart contents, total, and controls. */
export default function CartSummary({ darkMode = false }: CartSummaryProps) {
  const lines = useCartStore((s) => s.lines)
  const total = useCartStore((s) => s.total())
  const clear = useCartStore((s) => s.clear)

  if (lines.length === 0) {
    return (
      <div
        className={`rounded-xl p-6 text-center ring-1 ${
          darkMode
            ? 'bg-slate-900 text-slate-400 ring-slate-700'
            : 'bg-white text-slate-500 ring-slate-200'
        }`}
      >
        Your cart is empty.
      </div>
    )
  }

  return (
    <div
      className={`rounded-xl p-4 ring-1 ${
        darkMode ? 'bg-slate-900 ring-slate-700' : 'bg-white ring-slate-200'
      }`}
    >
      <div className={darkMode ? 'divide-y divide-slate-700' : 'divide-y divide-slate-100'}>
        {lines.map((line) => (
          <CartItem key={line.product.id} line={line} darkMode={darkMode} />
        ))}
      </div>
      <div
        className={`mt-4 flex items-center justify-between border-t pt-4 ${
          darkMode ? 'border-slate-700' : 'border-slate-200'
        }`}
      >
        <div>
          <p className={`text-sm ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
            Total
          </p>
          <p className={`text-xl font-semibold ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>
            ${total.toFixed(2)}
          </p>
        </div>
        <Button variant="ghost" onClick={clear}>
          Clear cart
        </Button>
      </div>
    </div>
  )
}
