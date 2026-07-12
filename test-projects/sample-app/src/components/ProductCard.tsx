import { Link } from 'react-router-dom'
import type { Product } from '../lib/types'
import { useCartStore } from '../store/cartStore'
import Rating from './Rating'
import Button from './Button'
import styles from './ProductCard.module.css'

interface ProductCardProps {
  product: Product
}

/** Storefront card. Uses a CSS Module for the shell and Tailwind for content. */
export default function ProductCard({ product }: ProductCardProps) {
  const add = useCartStore((s) => s.add)

  return (
    <div className={styles.card}>
      <Link to={`/products/${product.id}`}>
        <img
          className={styles.thumb}
          src={product.thumbnailUrl}
          alt={product.title}
        />
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <Link
          to={`/products/${product.id}`}
          className="line-clamp-2 text-sm font-medium text-slate-800 hover:text-indigo-600"
        >
          {product.title}
        </Link>
        <Rating value={(product.id % 5) + 1} />
        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="font-semibold text-slate-900">
            ${product.price.toFixed(2)}
          </span>
          <Button onClick={() => add(product)}>Add</Button>
        </div>
      </div>
    </div>
  )
}
