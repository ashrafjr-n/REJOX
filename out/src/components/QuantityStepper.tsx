import { Pressable, Text, View } from 'react-native';

// ===== REJOX-TODO: 1 item(s) need attention =====
// REJOX-TODO(FLEX_ROW_MADE_EXPLICIT): flex container at line 12: web defaults to row, RN to column — appended flex-row.

interface QuantityStepperProps {
  quantity: number
  onChange: (quantity: number) => void
}

/** +/- stepper for adjusting a cart line quantity. */
export default function QuantityStepper({
  quantity,
  onChange,
}: QuantityStepperProps) {
  return (
    <View className="flex items-center gap-2 flex-row">
      <Pressable
        className="h-7 w-7 rounded-md bg-slate-100 text-slate-700 active:bg-slate-200"
        onPress={() => onChange(quantity - 1)}
        aria-label="Decrease quantity"
      >
        <Text>−</Text>
      </Pressable>
      <Text className="w-6 text-center text-sm font-medium">{quantity}</Text>
      <Pressable
        className="h-7 w-7 rounded-md bg-slate-100 text-slate-700 active:bg-slate-200"
        onPress={() => onChange(quantity + 1)}
        aria-label="Increase quantity"
      >
        <Text>+</Text>
      </Pressable>
    </View>
  )
}
