import type { CartLine } from '../lib/types'
import { useCartStore } from '../store/cartStore'
import QuantityStepper from './QuantityStepper'

interface CartItemProps {
  line: CartLine
}

/** A single row in the cart summary. */
export default function CartItem({ line }: CartItemProps) {
  const setQuantity = useCartStore((s) => s.setQuantity)
  const remove = useCartStore((s) => s.remove)
  const { product, quantity } = line

  return (
    <div className="flex items-center gap-3 py-3">
      <img
        src={product.thumbnailUrl}
        alt={product.title}
        className="h-14 w-14 rounded-md object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 text-sm font-medium">{product.title}</p>
        <p className="text-sm text-slate-500">${product.price.toFixed(2)}</p>
      </div>
      <QuantityStepper
        quantity={quantity}
        onChange={(q) => setQuantity(product.id, q)}
      />
      <button
        className="text-sm text-slate-400 hover:text-red-500"
        onClick={() => remove(product.id)}
        aria-label="Remove item"
      >
        ✕
      </button>
    </div>
  )
}
