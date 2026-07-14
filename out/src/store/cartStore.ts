import { create } from 'zustand'
import type { CartLine, Product } from '../lib/types'

interface CartState {
  lines: CartLine[]
  add: (product: Product) => void
  remove: (productId: number) => void
  setQuantity: (productId: number, quantity: number) => void
  clear: () => void
  count: () => number
  total: () => number
}

/** Zustand store holding the shopping cart. */
export const useCartStore = create<CartState>((set, get) => ({
  lines: [],

  add: (product) =>
    set((state) => {
      const existing = state.lines.find((l) => l.product.id === product.id)
      if (existing) {
        return {
          lines: state.lines.map((l) =>
            l.product.id === product.id
              ? { ...l, quantity: l.quantity + 1 }
              : l,
          ),
        }
      }
      return { lines: [...state.lines, { product, quantity: 1 }] }
    }),

  remove: (productId) =>
    set((state) => ({
      lines: state.lines.filter((l) => l.product.id !== productId),
    })),

  setQuantity: (productId, quantity) =>
    set((state) => ({
      lines: state.lines
        .map((l) =>
          l.product.id === productId ? { ...l, quantity } : l,
        )
        .filter((l) => l.quantity > 0),
    })),

  clear: () => set({ lines: [] }),

  count: () => get().lines.reduce((n, l) => n + l.quantity, 0),

  total: () =>
    Math.round(
      get().lines.reduce((sum, l) => sum + l.product.price * l.quantity, 0) *
      100,
    ) / 100,
}))
