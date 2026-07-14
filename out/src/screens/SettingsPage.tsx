import { Text, View } from 'react-native';
import { useState } from 'react'
import SettingToggle from '../components/SettingToggle'
import CartSummary from '../components/CartSummary'


/** Settings page + the cart review area (where the CartBadge links to). */
export default function SettingsPage() {
  const [notifications, setNotifications] = useState(true)
  const [darkMode, setDarkMode] = useState(false)

  return (
    <View className="flex flex-col gap-8">
      <View>
        <Text className="text-2xl font-bold">Your cart</Text>
        <Text className="mb-4 text-slate-500">Review items before checkout.</Text>
        <CartSummary />
      </View>

      <View>
        <Text className="text-xl font-bold">Preferences</Text>
        <View className="mt-2 rounded-xl bg-white px-4 ring-1 ring-slate-200">
          <SettingToggle
            label="Email notifications"
            description="Get order updates by email."
            checked={notifications}
            onChange={setNotifications}
          />
          <SettingToggle
            label="Dark mode"
            description="Use a darker theme across the store."
            checked={darkMode}
            onChange={setDarkMode}
          />
        </View>
      </View>
    </View>
  )
}
