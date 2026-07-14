import { View } from 'react-native';

// ===== REJOX-TODO: 1 item(s) need attention =====
// REJOX-TODO(FLEX_ROW_MADE_EXPLICIT): flex container at line 4: web defaults to row, RN to column — appended flex-row.

/** Simple loading spinner. */
export default function Spinner() {
  return (
    <View className="flex items-center justify-center py-16 flex-row">
      <View className="h-8 w-8 rounded-full border-4 border-slate-200 border-t-indigo-600" />
    </View>
  )
}
