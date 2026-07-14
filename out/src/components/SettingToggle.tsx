import { Pressable, Text, View } from 'react-native';

// ===== REJOX-TODO: 1 item(s) need attention =====
// REJOX-TODO(FLEX_ROW_MADE_EXPLICIT): flex container at line 16: web defaults to row, RN to column — appended flex-row.

interface SettingToggleProps {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}

/** A labelled toggle row used on the Settings page. */
export default function SettingToggle({
  label,
  description,
  checked,
  onChange,
}: SettingToggleProps) {
  return (
    <View className="flex items-center justify-between gap-4 py-4 flex-row">
      <View>
        <Text className="font-medium text-slate-900">{label}</Text>
        <Text className="text-sm text-slate-500">{description}</Text>
      </View>
      <Pressable
        role="switch"
        aria-checked={checked}
        onPress={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-indigo-600' : 'bg-slate-300'
          }`}
      >
        <Text
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'
            }`}
        />
      </Pressable>
    </View>
  )
}
