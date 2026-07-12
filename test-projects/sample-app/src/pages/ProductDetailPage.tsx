import { Link, useParams } from 'react-router-dom'
import { fetchProduct } from '../api/products'
import { useFetch } from '../hooks/useFetch'
import { useCartStore } from '../store/cartStore'
import Spinner from '../components/Spinner'
import ErrorMessage from '../components/ErrorMessage'
import Rating from '../components/Rating'
import Button from '../components/Button'

/** Product detail page — reads the :id URL param and loads that product. */
export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const add = useCartStore((s) => s.add)
  const { data, loading, error } = useFetch(
    () => fetchProduct(id ?? ''),
    [id],
  )

  if (loading) return <Spinner />
  if (error) return <ErrorMessage message={error.message} />
  if (!data) return null

  return (
    <div className="flex flex-col gap-6">
      <Link to="/products" className="text-sm text-indigo-600 hover:underline">
        ← Back to products
      </Link>
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <img
          src={data.url}
          alt={data.title}
          className="w-full rounded-xl bg-slate-100 object-cover"
        />
        <div className="flex flex-col gap-4">
          <h1 className="text-2xl font-bold capitalize">{data.title}</h1>
          <Rating value={(data.id % 5) + 1} />
          <p className="text-3xl font-semibold">${data.price.toFixed(2)}</p>
          <p className="text-slate-500">
            Product #{data.id}. A benchmark item for the Rejox migration engine.
          </p>
          <Button className="w-fit" onClick={() => add(data)}>
            Add to cart
          </Button>
        </div>
      </div>
    </div>
  )
}
