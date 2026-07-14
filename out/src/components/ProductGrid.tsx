import { View } from 'react-native';
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
    <View className="flex-row flex-wrap gap-4">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </View>
  )
}
