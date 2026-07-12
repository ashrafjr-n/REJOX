import { fetchProducts } from '../api/products'
import { useFetch } from '../hooks/useFetch'
import ProductGrid from '../components/ProductGrid'
import Spinner from '../components/Spinner'
import ErrorMessage from '../components/ErrorMessage'

/** Products listing page — fetches via the custom useFetch hook. */
export default function ProductsPage() {
  const { data, loading, error } = useFetch(() => fetchProducts(12), [])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Products</h1>
        <p className="text-slate-500">Browse the full catalogue.</p>
      </div>
      {loading && <Spinner />}
      {error && <ErrorMessage message={error.message} />}
      {data && <ProductGrid products={data} />}
    </div>
  )
}
