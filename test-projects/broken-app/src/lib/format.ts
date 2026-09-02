import type { Currency } from "./types";

const SYMBOL: Record<Currency, string> = { USD: "$", EUR: "€", GBP: "£" };

export function formatPrice(cents: number, currency: Currency = "USD"): string {
  return `${SYMBOL[currency]}${(cents / 100).toFixed(2)}`;
}
