import { Link } from 'react-router-dom'
import { useCartStore } from '../store/cartStore'

/** Cart icon with a live item-count badge, links to Settings/cart area. */
export default function CartBadge() {
  const count = useCartStore((s) => s.count())

  return (
    <Link
      to="/settings"
      className="relative rounded-md px-2 py-1 text-slate-700 hover:bg-slate-100"
    >
      🛒
      {count > 0 && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-600 px-1 text-xs font-semibold text-white">
          {count}
        </span>
      )}
    </Link>
  )
}
