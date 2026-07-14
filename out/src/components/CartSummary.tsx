import { Text, View } from 'react-native';
import { useCartStore } from '../store/cartStore'
import CartItem from './CartItem'
import Button from './Button'

// ===== REJOX-TODO: 1 item(s) need attention =====
// REJOX-TODO(FLEX_ROW_MADE_EXPLICIT): flex container at line 26: web defaults to row, RN to column — appended flex-row.

/** Renders the cart contents, total, and controls. */
export default function CartSummary() {
  const lines = useCartStore((s) => s.lines)
  const total = useCartStore((s) => s.total())
  const clear = useCartStore((s) => s.clear)

  if (lines.length === 0) {
    return (
      <View className="rounded-xl bg-white p-6 text-center text-slate-500 ring-1 ring-slate-200">
        <Text>Your cart is empty.</Text>
      </View>
    )
  }

  return (
    <View className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <View className="">
        {lines.map((line) => (
          <CartItem key={line.product.id} line={line} />
        ))}
      </View>
      <View className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4 flex-row">
        <View>
          <Text className="text-sm text-slate-500">Total</Text>
          <Text className="text-xl font-semibold">${total.toFixed(2)}</Text>
        </View>
        <Button variant="ghost" onPress={clear}>
          <Text>Clear cart</Text>
        </Button>
      </View>
    </View>
  )
}
