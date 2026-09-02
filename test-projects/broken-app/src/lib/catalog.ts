import type { CatalogItem } from "./types";

const ENDPOINT = "/api/catalog";

export async function loadCatalog(): Promise<CatalogItem[]> {
  const res = await fetch(ENDPOINT);
  if (!res.ok) throw new Error(`catalog request failed: ${res.status}`);
  return (await res.json()) as CatalogItem[];
}
