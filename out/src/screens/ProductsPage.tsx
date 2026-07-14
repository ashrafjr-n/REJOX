import { Text, View } from 'react-native';
import { fetchProducts } from '../api/products'
import { useFetch } from '../hooks/useFetch'
import ProductGrid from '../components/ProductGrid'
import Spinner from '../components/Spinner'
import ErrorMessage from '../components/ErrorMessage'

/** Products listing page — fetches via the custom useFetch hook. */
export default function ProductsPage() {
  const { data, loading, error } = useFetch(() => fetchProducts(12), [])

  return (
    <View className="flex flex-col gap-6">
      <View>
        <Text className="text-2xl font-bold">Products</Text>
        <Text className="text-slate-500">Browse the full catalogue.</Text>
      </View>
      {loading && <Spinner />}
      {error && <ErrorMessage message={error.message} />}
      {data && <ProductGrid products={data} />}
    </View>
  )
}
