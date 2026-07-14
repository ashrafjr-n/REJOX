import { Text, View } from 'react-native';

/** Page footer. */
export default function Footer() {
  return (
    <View className="border-t border-slate-200 bg-white">
      <View className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-slate-500 sm:flex-row">
        <Text>© 2026 Sample Store — a Rejox migration benchmark.</Text>
        <Text>Built with React + Vite</Text>
      </View>
    </View>
  )
}
