import { Text, View } from 'react-native';


interface FeatureCardProps {
  icon: string
  title: string
  description: string
}

/** Small marketing card used on the home page feature row. */
export default function FeatureCard({
  icon,
  title,
  description,
}: FeatureCardProps) {
  return (
    <View className="flex flex-col gap-2 rounded-xl bg-white p-5 ring-1 ring-slate-200 active:shadow-md">
      <Text className="text-2xl">{icon}</Text>
      <Text className="font-semibold text-slate-900">{title}</Text>
      <Text className="text-sm text-slate-500">{description}</Text>
    </View>
  )
}
