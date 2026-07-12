import { Link } from 'react-router-dom'
import Button from './Button'

/** Home page hero banner with a responsive two-column flex layout. */
export default function Hero() {
  return (
    <section className="flex flex-col items-center gap-6 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 p-8 text-white sm:flex-row sm:justify-between sm:p-12">
      <div className="max-w-lg">
        <h1 className="text-3xl font-bold sm:text-4xl">
          Everything you need, in one place.
        </h1>
        <p className="mt-3 text-indigo-100">
          A small but realistic storefront used as the migration benchmark for
          Rejox AI.
        </p>
      </div>
      <Link to="/products">
        <Button className="bg-white text-indigo-700 hover:bg-indigo-50">
          Shop products
        </Button>
      </Link>
    </section>
  )
}
