import { Text, View } from 'react-native';

// ===== REJOX-TODO: 1 item(s) need attention =====
// REJOX-TODO(FLEX_ROW_MADE_EXPLICIT): flex container at line 9: web defaults to row, RN to column — appended flex-row.

interface RatingProps {
  /** Score from 0-5. */
  value: number
}

/** Renders a row of five stars using a flex layout. */
export default function Rating({ value }: RatingProps) {
  return (
    <View className="flex items-center gap-0.5 flex-row" aria-label={`Rated ${value} of 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Text
          key={i}
          className={i < value ? 'text-amber-400' : 'text-slate-300'}
        >
          ★
        </Text>
      ))}
    </View>
  )
}
