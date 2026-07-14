# Rejox Migration Report — sample-app

Deterministic emission of the React Native project. Every file below was produced by rules (no AI). `unhandled` items are the residue the AI Resolution Engine will resolve; each also leaves a `// REJOX-TODO(<CODE>)` marker in the code.


## Summary

- Files emitted: **42**
- Files with residue (TODOs): **1**
- Total REJOX-TODO items: **13**
- Files skipped (web-only / not found): **6**


## Provenance (per file)

| File | From | Provenance | Residue |
| ---- | ---- | ---------- | ------- |
| `.gitignore` | _(generated)_ | deterministic-warning | — |
| `App.tsx` | src/App.tsx | deterministic-warning | — |
| `app.json` | _(generated)_ | deterministic-warning | — |
| `babel.config.js` | _(generated)_ | deterministic-warning | — |
| `global.css` | _(generated)_ | deterministic-warning | — |
| `index.ts` | _(generated)_ | deterministic-warning | — |
| `metro.config.js` | _(generated)_ | deterministic-warning | — |
| `nativewind-env.d.ts` | _(generated)_ | deterministic-warning | — |
| `package.json` | _(generated)_ | deterministic-warning | — |
| `src/api/.gitkeep` | _(generated)_ | deterministic-warning | — |
| `src/api/client.ts` | src/api/client.ts | deterministic | — |
| `src/api/products.ts` | src/api/products.ts | deterministic | — |
| `src/assets/hero.png` | src/assets/hero.png | deterministic | — |
| `src/components/.gitkeep` | _(generated)_ | deterministic-warning | — |
| `src/components/Button.tsx` | src/components/Button.tsx | deterministic-warning | PROPS_TYPE_MAPPED |
| `src/components/CartBadge.tsx` | src/components/CartBadge.tsx | deterministic-warning | FLEX_ROW_MADE_EXPLICIT |
| `src/components/CartItem.tsx` | src/components/CartItem.tsx | deterministic-warning | FLEX_ROW_MADE_EXPLICIT |
| `src/components/CartSummary.tsx` | src/components/CartSummary.tsx | deterministic-warning | FLEX_ROW_MADE_EXPLICIT |
| `src/components/ErrorMessage.tsx` | src/components/ErrorMessage.tsx | deterministic | — |
| `src/components/FeatureCard.tsx` | src/components/FeatureCard.tsx | deterministic | — |
| `src/components/Footer.tsx` | src/components/Footer.tsx | deterministic | — |
| `src/components/Hero.tsx` | src/components/Hero.tsx | deterministic | — |
| `src/components/Navbar.tsx` | src/components/Navbar.tsx | unhandled | NAV_LINK |
| `src/components/ProductCard.tsx` | src/components/ProductCard.tsx | deterministic-warning | FLEX_ROW_MADE_EXPLICIT, IMAGE_SIZE |
| `src/components/ProductGrid.tsx` | src/components/ProductGrid.tsx | deterministic | — |
| `src/components/QuantityStepper.tsx` | src/components/QuantityStepper.tsx | deterministic-warning | FLEX_ROW_MADE_EXPLICIT |
| `src/components/Rating.tsx` | src/components/Rating.tsx | deterministic-warning | FLEX_ROW_MADE_EXPLICIT |
| `src/components/SettingToggle.tsx` | src/components/SettingToggle.tsx | deterministic-warning | FLEX_ROW_MADE_EXPLICIT |
| `src/components/Spinner.tsx` | src/components/Spinner.tsx | deterministic-warning | FLEX_ROW_MADE_EXPLICIT |
| `src/hooks/.gitkeep` | _(generated)_ | deterministic-warning | — |
| `src/hooks/useFetch.ts` | src/hooks/useFetch.ts | deterministic | — |
| `src/lib/types.ts` | src/lib/types.ts | deterministic | — |
| `src/navigation/AppNavigator.tsx` | src/App.tsx | deterministic-warning | — |
| `src/screens/.gitkeep` | _(generated)_ | deterministic-warning | — |
| `src/screens/HomePage.tsx` | src/pages/HomePage.tsx | deterministic | — |
| `src/screens/ProductDetailPage.tsx` | src/pages/ProductDetailPage.tsx | deterministic-warning | IMAGE_SIZE |
| `src/screens/ProductsPage.tsx` | src/pages/ProductsPage.tsx | deterministic | — |
| `src/screens/SettingsPage.tsx` | src/pages/SettingsPage.tsx | deterministic | — |
| `src/store/.gitkeep` | _(generated)_ | deterministic-warning | — |
| `src/store/cartStore.ts` | src/store/cartStore.ts | deterministic | — |
| `tailwind.config.js` | _(generated)_ | deterministic-warning | — |
| `tsconfig.json` | _(generated)_ | deterministic-warning | — |

## Skipped

- `index.html` — web-only (HTML entry / global CSS handled by the scaffold)
- `public/favicon.svg` — web-only asset (favicon/static)
- `public/icons.svg` — web-only asset (favicon/static)
- `src/assets/vite.svg` — web-only asset (favicon/static)
- `src/components/Layout.tsx` — router-structure component (Outlet/Routes) subsumed by the generated navigator; re-express its chrome via the chosen navigator shape (see the navigation plan question)
- `src/index.css` — web-only (HTML entry / global CSS handled by the scaffold)
