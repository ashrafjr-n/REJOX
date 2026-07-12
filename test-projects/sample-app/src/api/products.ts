import { client } from './client'
import type { Product } from '../lib/types'

/** Raw shape returned by the /photos endpoint. */
interface PhotoDto {
  id: number
  title: string
  url: string
  thumbnailUrl: string
}

/** Deterministically derive a plausible price from the product id. */
function priceFor(id: number): number {
  return Math.round((((id * 37) % 90) + 10) * 100) / 100
}

function toProduct(dto: PhotoDto): Product {
  return {
    id: dto.id,
    title: dto.title,
    url: dto.url,
    thumbnailUrl: dto.thumbnailUrl,
    price: priceFor(dto.id),
  }
}

/** Fetch a page of products. */
export async function fetchProducts(limit = 12): Promise<Product[]> {
  const { data } = await client.get<PhotoDto[]>('/photos', {
    params: { _limit: limit },
  })
  return data.map(toProduct)
}

/** Fetch a single product by id. */
export async function fetchProduct(id: string | number): Promise<Product> {
  const { data } = await client.get<PhotoDto>(`/photos/${id}`)
  return toProduct(data)
}
