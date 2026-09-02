export type Currency = "USD" | "EUR" | "GBP";

export interface CatalogItem {
  id: string;
  title: string;
  price: number;
  currency: Currency;
  inStock: boolean;
}
