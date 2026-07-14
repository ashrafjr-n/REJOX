import { Text, View } from 'react-native';

interface ErrorMessageProps {
  message: string
}

/** Inline error banner. */
export default function ErrorMessage({ message }: ErrorMessageProps) {
  return (
    <View className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
      <Text>{message}</Text>
    </View>
  )
}
