import { useNavigation } from '@react-navigation/native';
import { Pressable, Text } from 'react-native';
import { useCartStore } from '../store/cartStore'

// ===== REJOX-TODO: 1 item(s) need attention =====
// REJOX-TODO(FLEX_ROW_MADE_EXPLICIT): flex container at line 12: web defaults to row, RN to column — appended flex-row.

/** Cart icon with a live item-count badge, links to Settings/cart area. */
export default function CartBadge() {
  const navigation = useNavigation<any>();
  const count = useCartStore((s) => s.count())

  return (
    <Pressable className="relative rounded-md px-2 py-1 text-slate-700 active:bg-slate-100" onPress={() => navigation.navigate('Settings')}><Text>🛒</Text>
      {count > 0 && (
        <Text className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-600 px-1 text-xs font-semibold text-white flex-row">
          {count}
        </Text>
      )}</Pressable>
  )
}
