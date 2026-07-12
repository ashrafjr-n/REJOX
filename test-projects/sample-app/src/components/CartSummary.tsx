import { useCartStore } from '../store/cartStore'
import CartItem from './CartItem'
import Button from './Button'

/** Renders the cart contents, total, and controls. */
export default function CartSummary() {
  const lines = useCartStore((s) => s.lines)
  const total = useCartStore((s) => s.total())
  const clear = useCartStore((s) => s.clear)

  if (lines.length === 0) {
    return (
      <div className="rounded-xl bg-white p-6 text-center text-slate-500 ring-1 ring-slate-200">
        Your cart is empty.
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <div className="divide-y divide-slate-100">
        {lines.map((line) => (
          <CartItem key={line.product.id} line={line} />
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4">
        <div>
          <p className="text-sm text-slate-500">Total</p>
          <p className="text-xl font-semibold">${total.toFixed(2)}</p>
        </div>
        <Button variant="ghost" onClick={clear}>
          Clear cart
        </Button>
      </div>
    </div>
  )
}
