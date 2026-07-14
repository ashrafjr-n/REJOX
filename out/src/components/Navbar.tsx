import { useNavigation } from '@react-navigation/native';
import { Pressable, Text, View } from 'react-native';
import CartBadge from './CartBadge'

// ===== REJOX-TODO: 3 item(s) need attention =====
// REJOX-TODO(NAV_LINK): <NavLink> at line 20: 'to' has no static route-table match; wire navigation.navigate({link.to}).
// REJOX-TODO(FLEX_ROW_MADE_EXPLICIT): flex container at line 15: web defaults to row, RN to column — appended flex-row.
// REJOX-TODO(FLEX_ROW_MADE_EXPLICIT): flex container at line 18: web defaults to row, RN to column — appended flex-row.

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/products', label: 'Products', end: false },
  { to: '/settings', label: 'Settings', end: false },
]

/** Top navigation bar with a horizontal flex layout and hover/active states. */
export default function Navbar() {
  const navigation = useNavigation<any>();
  return (
    <View className="top-0 z-10 border-b border-slate-200 bg-white/90">
      <View className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 flex-row">
        <Pressable className="text-lg font-bold text-indigo-600" onPress={() => navigation.navigate('Home')}><Text>Sample&nbsp;Store</Text>
        </Pressable>
        <View className="flex items-center gap-1 flex-row">
          {links.map((link) => (
            <Pressable key={link.to} className="rounded-md px-3 py-1.5 text-sm font-medium active:bg-slate-100 text-slate-600" onPress={() => { }}>{/* REJOX-TODO(NAV_LINK): wire navigation.navigate({link.to}) */}<Text>{link.label}</Text></Pressable>
          ))}
          <CartBadge />
        </View>
      </View>
    </View>
  )
}
