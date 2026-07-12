/** A product shown in the storefront. */
export interface Product {
  id: number
  title: string
  /** Full-size image URL. */
  url: string
  /** Small preview image URL. */
  thumbnailUrl: string
  /** Derived, deterministic display price (the fake API has none). */
  price: number
}

/** A line item in the shopping cart. */
export interface CartLine {
  product: Product
  quantity: number
}
