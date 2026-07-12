import type { Product } from '../lib/types'
import ProductCard from './ProductCard'

interface ProductGridProps {
  products: Product[]
}

/**
 * Responsive grid (1 → 2 → 3 → 4 columns). CSS grid + breakpoints are an
 * intentionally hard case for the React Native migration.
 */
export default function ProductGrid({ products }: ProductGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  )
}
