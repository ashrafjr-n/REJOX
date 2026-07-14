import { useNavigation } from '@react-navigation/native';
import { Pressable, Text, View } from 'react-native';
import Button from './Button'


/** Home page hero banner with a responsive two-column flex layout. */
export default function Hero() {
  const navigation = useNavigation<any>();
  return (
    <View className="flex flex-col items-center gap-6 rounded-2xl p-8 text-white sm:flex-row sm:justify-between sm:p-12">
      <View className="max-w-lg">
        <Text className="text-3xl font-bold sm:text-4xl">
          Everything you need, in one place.
        </Text>
        <Text className="mt-3 text-indigo-100">
          A small but realistic storefront used as the migration benchmark for
          Rejox AI.
        </Text>
      </View>
      <Pressable onPress={() => navigation.navigate('Products')}><Button className="bg-white text-indigo-700 active:bg-indigo-50">
        <Text>Shop products</Text>
      </Button></Pressable>
    </View>
  )
}
