import { Image, Pressable, Text, View } from 'react-native';
import type { CartLine } from '../lib/types'
import { useCartStore } from '../store/cartStore'
import QuantityStepper from './QuantityStepper'

// ===== REJOX-TODO: 1 item(s) need attention =====
// REJOX-TODO(FLEX_ROW_MADE_EXPLICIT): flex container at line 16: web defaults to row, RN to column — appended flex-row.

interface CartItemProps {
  line: CartLine
}

/** A single row in the cart summary. */
export default function CartItem({ line }: CartItemProps) {
  const setQuantity = useCartStore((s) => s.setQuantity)
  const remove = useCartStore((s) => s.remove)
  const { product, quantity } = line

  return (
    <View className="flex items-center gap-3 py-3 flex-row">
      <Image source={{ uri: product.thumbnailUrl }} accessibilityLabel={product.title} className="h-14 w-14 rounded-md object-cover" />
      <View className="min-w-0 flex-1">
        <Text className="line-clamp-1 text-sm font-medium">{product.title}</Text>
        <Text className="text-sm text-slate-500">${product.price.toFixed(2)}</Text>
      </View>
      <QuantityStepper
        quantity={quantity}
        onChange={(q) => setQuantity(product.id, q)}
      />
      <Pressable
        className="text-sm text-slate-400 active:text-red-500"
        onPress={() => remove(product.id)}
        aria-label="Remove item"
      >
        <Text>✕</Text>
      </Pressable>
    </View>
  )
}
