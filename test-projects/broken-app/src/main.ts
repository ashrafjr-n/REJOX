// The entry point mounts nothing: the component tree this file used to render
// lives in `packages/web/`, which is not part of this upload.
import { loadCatalog } from "./lib/catalog";
import { formatPrice } from "./lib/format";

const root = document.getElementById("root");
if (root) {
  loadCatalog().then((items) => {
    root.textContent = items.map((i) => `${i.title} ${formatPrice(i.price)}`).join("\n");
  });
}
