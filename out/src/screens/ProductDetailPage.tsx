import { useNavigation, useRoute } from '@react-navigation/native';
import { Image, Pressable, Text, View } from 'react-native';
import { fetchProduct } from '../api/products'
import { useFetch } from '../hooks/useFetch'
import { useCartStore } from '../store/cartStore'
import Spinner from '../components/Spinner'
import ErrorMessage from '../components/ErrorMessage'
import Rating from '../components/Rating'
import Button from '../components/Button'

// ===== REJOX-TODO: 1 item(s) need attention =====
// REJOX-TODO(IMAGE_SIZE): <Image> at line 29 had no provable height; injected 100 — adjust to the intended dimensions.

/** Product detail page — reads the :id URL param and loads that product. */
export default function ProductDetailPage() {
  const navigation = useNavigation<any>();
  const { id } = ((useRoute().params ?? {}) as { id: string })
  const add = useCartStore((s) => s.add)
  const { data, loading, error } = useFetch(
    () => fetchProduct(id ?? ''),
    [id],
  )

  if (loading) return <Spinner />
  if (error) return <ErrorMessage message={error.message} />
  if (!data) return null

  return (
    <View className="flex flex-col gap-6">
      <Pressable className="text-sm text-indigo-600 active:underline" onPress={() => navigation.navigate('Products')}><Text>← Back to products</Text>
      </Pressable>
      <View className="flex-row flex-wrap gap-8">
        <Image source={{ uri: data.url }} accessibilityLabel={data.title} className="w-full rounded-xl bg-slate-100 object-cover" style={{ height: 100 }} />
        <View className="flex flex-col gap-4">
          <Text className="text-2xl font-bold capitalize">{data.title}</Text>
          <Rating value={(data.id % 5) + 1} />
          <Text className="text-3xl font-semibold">${data.price.toFixed(2)}</Text>
          <Text className="text-slate-500">
            Product #{data.id}. A benchmark item for the Rejox migration engine.
          </Text>
          <Button className="w-fit" onPress={() => add(data)}>
            <Text>Add to cart</Text>
          </Button>
        </View>
      </View>
    </View>
  )
}
