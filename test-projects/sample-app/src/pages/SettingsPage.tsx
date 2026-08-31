import { useState } from 'react'
import SettingToggle from '../components/SettingToggle'
import CartSummary from '../components/CartSummary'

interface SettingsPageProps {
  darkMode: boolean
  setDarkMode: (value: boolean) => void
}

/** Settings page + the cart review area (where the CartBadge links to). */
export default function SettingsPage({
  darkMode,
  setDarkMode,
}: SettingsPageProps) {
  const [notifications, setNotifications] = useState(true)

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className={`text-2xl font-bold ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>
          Your cart
        </h1>
        <p className={`mb-4 ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
          Review items before checkout.
        </p>
        <CartSummary darkMode={darkMode} />
      </section>

      <section>
        <h2 className={`text-xl font-bold ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>
          Preferences
        </h2>
        <div
          className={`mt-2 divide-y rounded-xl px-4 ring-1 ${
            darkMode
              ? 'divide-slate-700 bg-slate-900 ring-slate-700'
              : 'divide-slate-100 bg-white ring-slate-200'
          }`}
        >
          <SettingToggle
            label="Email notifications"
            description="Get order updates by email."
            checked={notifications}
            onChange={setNotifications}
            darkMode={darkMode}
          />
          <SettingToggle
            label="Dark mode"
            description="Use a darker theme across the store."
            checked={darkMode}
            onChange={setDarkMode}
            darkMode={darkMode}
          />
        </div>
      </section>
    </div>
  )
}
