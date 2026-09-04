# React → React Native Conversion Rules

This is a **living document**. It is the single source of truth for how React
(web) patterns map to React Native. Before writing or changing any conversion
logic (see `CLAUDE.md` golden rule), consult this table. If a pattern is missing,
add a row here **first**, then implement it.

**Confidence** = how safely the mapping can be applied automatically:
`High` (mechanical, safe), `Medium` (usually safe, may need review),
`Low` (needs human decision / no clean equivalent).

| React pattern                     | React Native equivalent                     | Confidence | Notes |
| --------------------------------- | ------------------------------------------- | ---------- | ----- |
| `<div>`                           | `<View>`                                    | High       | Default layout container. Block-level → View. |
| `<span>`, `<p>`                   | `<Text>`                                    | High       | All text must live inside `<Text>` in RN. |
| `<img>`                           | `<Image>` (from `react-native`)             | High       | `src` → `source={{ uri }}`; requires explicit width/height. |
| `onClick`                         | `onPress`                                   | High       | On `Pressable` / `TouchableOpacity` / `Button`. |
| `className` / Tailwind            | NativeWind `className`                      | Medium     | NativeWind maps most utilities; some (hover, grid) have no RN equivalent. |
| `className` naming a class the project defines in its own CSS (`.app`, `.black_btn` — usually via `@apply`) | — (NativeWind resolves Tailwind utilities only) | Low | **Not a Tailwind class.** NativeWind ignores it silently, so the element renders unstyled. Counted as **unmappable** and named in the report — never counted as a mapped Tailwind class, which would inflate Coverage while the app loses its design. |
| `react-router-dom`                | React Navigation (`@react-navigation/*`)    | Medium     | `Link`→`navigation.navigate` and `useParams`→`useRoute` are **automated** (route table); navigator STRUCTURE (stack/tab) stays a design decision. |
| CSS `:hover`                      | — (no equivalent)                           | Low        | No hover on touch. Flag; optionally map to press/focus state. |
| `localStorage`                    | `AsyncStorage` (`@react-native-async-storage`) | Medium  | API is async — call sites must be awaited. |
| `<a href>`                        | `Linking.openURL` / `<Pressable>`           | Medium     | External links → `Linking`; internal → navigation. |
| `import.meta.env.VITE_X` (Vite build-time env) | `process.env.EXPO_PUBLIC_X`             | High       | Both are inlined by the bundler, so the read stays a static member expression — Metro only inlines `process.env.EXPO_PUBLIC_*` written out in full. The `VITE_` prefix is dropped: it is Vite's marker for "safe to ship to the client", and `EXPO_PUBLIC_` is Expo's. The **value** does not migrate — a `.env` is not part of an uploaded project, and a key that reaches the client is public either way. |
| `import.meta.env.DEV` / `.PROD` / `.MODE` / `.SSR` | `__DEV__` / `(!__DEV__)` / `(__DEV__ ? 'development' : 'production')` / `false` | High | RN's own build flag. `SSR` is `false`: there is no server render of a native app. |
| `import.meta` used any other way (`.url`, `.hot`, `.glob`, a dynamic key, the whole `env` object) | — (no equivalent) | Low | Residue code `BUILD_ENV`. `import.meta` is a Vite/ESM bundler feature Metro rejects outright (`'import.meta' is currently unsupported`) — one occurrence fails the whole bundle, so it is never left in place silently. |
| `<input>`                         | `<TextInput>`                               | High       | `onChange`→`onChangeText`; `value` prop preserved. |
| `<button>`                        | `<Pressable>` / `<Button>`                  | High       | Prefer `Pressable` for custom styling. |
| `<ul>` / `<ol>` / `<li>`          | `<FlatList>` / `<View>` + `<Text>`          | Medium     | Long/dynamic lists → `FlatList`; small static → mapped Views. |
| CSS `display: flex`               | `flex` (default in RN)                       | High       | RN is flexbox by default; `flexDirection` defaults to `column`, not `row`. |
| CSS responsive grid / media query | `Dimensions` / `useWindowDimensions`         | Low        | No CSS grid or media queries; requires manual/LLM-assisted reflow. |
| Tailwind `grid` / `grid-cols-*`   | flexbox + `flex-wrap` (manual reflow)        | Low        | Analyzer code `CSS_GRID`. No CSS grid in RN. |
| Tailwind `hover:*`                | `Pressable` pressed/`onPressIn` state        | Low        | Analyzer code `HOVER_STATE`. No hover on touch. |
| Tailwind `sm:`/`md:`/`lg:` prefixes | NativeWind breakpoints / `useWindowDimensions` | Medium  | Analyzer code `RESPONSIVE_BREAKPOINT`. Needs NativeWind config. |
| Tailwind `bg-gradient`/`from-`/`to-` | `expo-linear-gradient`                    | Medium     | Analyzer code `GRADIENT`. Not a core RN feature. |
| Tailwind `group`/`group-hover:`   | — (no equivalent)                            | Low        | Analyzer code `GROUP_SELECTOR`. No descendant selectors. |
| Dynamic `className` (clsx/cva)    | resolve statically or hand-convert           | Low        | Analyzer code `DYNAMIC_CLASSNAME`. Runtime classes can't be mapped statically. |
| CSS Module (`*.module.css`)       | `StyleSheet.create` / NativeWind             | Medium     | Analyzer code `CSS_MODULE`. Hand-convert per file. |
| `<table>` / `<canvas>` / `<iframe>` | — (no equivalent)                          | Low        | Analyzer code `WEB_ONLY_ELEMENT` (blocker). Out of MVP. |
| `<select>`                        | `@react-native-picker/picker`                | Medium     | Component/library swap. |
| `<form>`                          | `<View>` + controlled state                  | Medium     | No native form submit; wire `onSubmit` into state. |
| `onChange`                        | `onChangeText` / `onValueChange`             | High       | Analyzer code `EVENT_CONVERSION`. |
| `onSubmit` / `onMouseEnter` / `onKeyDown` | — (no equivalent)                    | Low        | Analyzer code `WEB_ONLY_EVENT`. No mouse/keyboard/submit on touch. |
| Redux / Three.js / Next.js / Electron | — (unsupported in MVP)                   | Low        | Analyzer code `UNSUPPORTED_LIBRARY` (blocker). See `PRD.md`. |

## Automated by the Deterministic Transformer

These rules are implemented as **deterministic** transforms in
`backend/codemod-worker` (ts-morph) — no AI. All are **Confidence: High /
automated**; this table is the product's proof of determinism. The worker
self-checks that its output is syntactically valid TS before emitting.

| Rule (implemented)                              | Transform                                            | Confidence |
| ----------------------------------------------- | ---------------------------------------------------- | ---------- |
| `div`/`section`/`header`/`footer`/`nav`/`ul`/`li`/`form` → `View` | tag rename            | ✅ High / automated |
| `span`/`p`/`h1`-`h6`/`label`/`small`/`strong`/`em` → `Text`       | tag rename            | ✅ High / automated |
| `img` → `Image`                                 | tag rename                                           | ✅ High / automated |
| `src="…"` → `source={{ uri: '…' }}` · `src={expr}` → `source={{ uri: expr }}` · imported asset → `source={asset}` | attribute reshape | ✅ High / automated |
| `alt` → `accessibilityLabel`; `width`/`height` attrs → `style` | attribute reshape       | ✅ High / automated |
| `<img>` with unprovable size → inject placeholder `style` + `IMAGE_SIZE` warning | size injection (the SHAPE is a rule; the number is design → flagged) | ✅ High / automated |
| `button` → `Pressable`                          | tag rename                                           | ✅ High / automated |
| container/text element with `onPress` → `Pressable` | interactive override                             | ✅ High / automated |
| Bare text / `{expr}` child of non-`Text` parent → wrap in `<Text>` | text-wrap pass       | ✅ High / automated |
| `<Link to>`/`<NavLink to>` (static / param / template path) → `<Pressable onPress={() => navigation.navigate('Screen', { params })}>` | route-table resolution + `useNavigation` hook & import injection | ✅ High / automated |
| `useParams<T>()` → `(useRoute().params ?? {}) as T` | hook swap + `useRoute` import                   | ✅ High / automated |
| `onClick` → `onPress` (host elements)           | attribute rename                                     | ✅ High / automated |
| `onClick` → `onPress` on PROJECT components with graph-proven DOM props (`propsExtends` ∋ `*HTMLAttributes`) | graph-resolved rename, consistent on both sides | ✅ High / automated |
| `extends ButtonHTMLAttributes<…>` → `extends PressableProps` (+ Anchor→Pressable, Input/Textarea→TextInput, Img→Image, Form/HTML→View props) | declarative DOM-interface → RN-interface map | ✅ High / automated |
| `onChange` on `input`/`textarea`/`select` → `onChangeText` | rename (+ `EVENT_ADAPTER` unhandled)      | ✅ High / automated |
| `onSubmit` → dropped (+ `FORM_SUBMIT` unhandled) | attribute removal                                   | ✅ High / automated |
| `onMouseEnter`/`onKeyDown`/… → dropped          | attribute removal (+ warning)                        | ✅ High / automated |
| DOM-only attributes surviving a tag rename → dropped: `type` on `button`→`Pressable`, `htmlFor` on `label`→`Text`, `target`/`rel`/`download` on `a`→`Pressable` (`href` is deliberately **kept** — the `<a>` Linking TODO points at it) | attribute removal (+ `WEB_ONLY_ATTRIBUTE` warning) — the RN component has no such prop, so carrying it over is a `tsc` error and never a behaviour | ✅ High / automated |
| `<Route element={<Screen a={a} />}>` where every prop is a plain read of the routing component's `useState` → `<Screen name>{() => <Screen a={a} />}</Screen>` + that `useState` hoisted into `AppNavigator` | navigator generation: `component=` takes a reference, not an element, so the props ride in the render callback and the state moves with the routing half it belonged to | ✅ High / automated |
| NativeWind-supported Tailwind classes           | **passed through untouched** (the mechanical majority) | ✅ High / automated |
| `space-x-*`/`space-y-*` → `gap-x-*`/`gap-y-*`   | class rename (child-selector spacing → flex gap)     | ✅ High / automated |
| `flex` with no direction → append `flex-row`    | web defaults to row, RN to column — direction made explicit | ✅ High / automated |
| Inject `import { … } from 'react-native'` / `'@react-navigation/native'` | for everything actually used | ✅ High / automated |
| Drop `react-dom` imports                        | import removal                                       | ✅ High / automated |
| Root component (`src/App.*`) in a project with **no router** → converted like any other component into `src/App.tsx`; the root `App.tsx` is a generated shell that renders it | root-component conversion (a router-less App is the app's real UI, not router wiring) | ✅ High / automated |
| `createRoot(…).render(<P a={a}><App/></P>)` / `ReactDOM.render(…)` → the provider chain is lifted into the generated root `App.tsx`, with the values it reads (imports + top-level declarations of the entry file) carried across | entry-point provider lift; `createRoot`/`document.getElementById`/`react-dom` have no RN equivalent and are dropped, the app-level configuration they wrapped is not | ✅ High / automated |
| `<StrictMode>` / `<React.Fragment>` / `<BrowserRouter>`… wrapping the root | dropped from the lifted chain — a stateless wrapper carries no app configuration, and a router provider is subsumed by the generated navigator | ✅ High / automated |
| `import.meta.env.VITE_X` → `process.env.EXPO_PUBLIC_X`; `import.meta.env.DEV`/`PROD`/`MODE`/`SSR` → `__DEV__`/`(!__DEV__)`/`(__DEV__ ? 'development' : 'production')`/`false` | static env read rewritten in place — the replacement is written out as a full member expression because that is the only form Metro inlines, and a parenthesised replacement keeps the surrounding expression's meaning. Anything else about `import.meta` (dynamic key, whole-object read, `.url`/`.hot`/`.glob`) is `BUILD_ENV` residue, never a guess: Metro refuses to bundle a file containing `import.meta` at all, so leaving one behind costs the whole app, not one value | ✅ High / automated |
| `import './App.css'` (a plain, non-module stylesheet) → dropped (+ `GLOBAL_CSS` unhandled) | import removal — RN has no stylesheet imports at all, and the file is never emitted; the TODO names the stylesheet so the loss is visible at the call site rather than only in the skip list. The skip note says the rules were **lost**, never that the scaffold handles them: the scaffold emits Tailwind directives only and knows nothing about the file's own classes | ✅ High / automated |
| **Every** package the emitted code imports (`@reduxjs/toolkit`, `react-redux`, `axios`, …) → carried into the scaffold's `package.json` | dependency carry-over, driven by scanning the module specifiers of the files that were actually WRITTEN — never a fixed list, and never only the import a provider lift happened to touch. A deep import (`@reduxjs/toolkit/query/react`) resolves to its package root. A package the output imports and `package.json` omits is an unresolvable module, and Metro fails on the first one | ✅ High / automated |

**The honest residue (`unhandled` → AI Resolution Engine)** — only what
genuinely requires judgment; every item also leaves a `// REJOX-TODO(<CODE>)`
comment so nothing is ever silently dropped:

| Residue code    | What it is                                                       | Why it needs reasoning |
| --------------- | ---------------------------------------------------------------- | ---------------------- |
| `NAV_LINK`      | `to` is a runtime expression with no static route-table match    | which screen is a runtime value |
| `NAV_ACTIVE`    | `NavLink` styles by `isActive`                                   | active state is navigation state; tab bar vs highlight is design |
| `NAV_CONTAINER` | `<Routes>`/`<Route>`/`<Outlet>` structure                        | navigator arrangement (stack/tab/drawer) is design |
| `NAV_HOOK`      | router hooks other than `useParams` still referenced             | imperative navigation intent |
| `NAV_SCREEN_PROPS` | a route element passed props the generator could **not** relocate — a spread, a derived expression, a value from a context, or a nested-navigator screen (hoisting there would make a second, independent copy of the state) | where such a value belongs once the router stops carrying it — a context/store, or `initialParams` — is design, not a rename. Plain reads of the routing component's own state are relocated instead, and leave no TODO |
| `CSS_MODULE`    | `*.module.css` imports                                           | restyling a stylesheet is design |
| `TW_UNSUPPORTED`| `hover:`/`group-*`/`grid-*`/gradients/`backdrop-*`/transitions/animations/`sticky`/`fixed`/`divide-*` | no RN equivalent; re-expression (pressed state, flex reflow, expo-linear-gradient, Moti) is design |
| `EVENT_ADAPTER` | `onChangeText` handler now receives a string                     | handler body may need reshaping |
| `FORM_SUBMIT`   | `onSubmit` semantics                                             | submission flow must move into state |
| `PROPS_HTML_TYPE` | DOM types with no clean RN equivalent (post-map)               | props API redesign |
| `WEB_ONLY_ELEMENT` | `table`/`canvas`/`iframe`/…                                   | needs a component redesign |
| `BUILD_ENV`     | `import.meta` in a form no static rewrite covers                 | where the value comes from once a build-time bundler constant is gone — an `EXPO_PUBLIC_` key, a native config, or a runtime fetch — is an app-configuration decision |

> **Update — most of this "residue" turned out to be rules.** Each of the codes
> below now has an AI-Resolution-Engine resolver that handles it deterministically;
> the LLM is reserved for the one genuine judgment (navigator shape):
> - `TW_UNSUPPORTED` → **Styling Resolver** (static-map + pattern) — 24/24 sample-app units, **0 LLM**.
> - `CSS_MODULE` → **CSS Module resolver** (postcss + CSS→RN table + ts-morph rewrite) — **0 LLM**; it is pure parsing.
> - `NAV_ACTIVE` → focus-state rule (`useIsFocused`) — **0 LLM**.
> - `NAV_CONTAINER` wiring → navigator generated from the route table — **0 LLM, no TODO survives**.
> - Navigator **shape** (tabs/stack/drawer) is the *only* genuine reasoning → **1 LLM call**, and even then the LLM returns a spec, not code.

## Automated by the AI Resolution Engine — Styling Resolver (tiers 1–2)

These resolve `TW_UNSUPPORTED` residue **deterministically**, before any LLM is
consulted (see `ARCHITECTURE.md` → *the three-tier ladder*). Tier 1 = static map
(`app/ai/styling/known_map.py`); tier 2 = pattern (`patterns.py`). Anything a
row here handles must **not** go to the LLM — that is the design, enforced by the
ordering in `resolver.py`.

**Tier 1 — static map** (fixed, well-known RN equivalent):

| Unsupported Tailwind        | React Native equivalent                                   | Tier / status |
| --------------------------- | --------------------------------------------------------- | ------------- |
| `divide-y` / `divide-x` (+ `divide-<color>`) | hairline `borderTopWidth`/`borderLeftWidth` (+ `borderColor` hex) on each child after the first | ✅ static-map / automated |
| `animate-spin`              | documented Reanimated 360° loop (`withRepeat(withTiming(360…))` + `useAnimatedStyle` rotate) | ✅ static-map / automated |
| `backdrop-blur` / `backdrop-*` | `expo-blur` `<BlurView intensity tint style={StyleSheet.absoluteFill}>` | ✅ static-map / automated |
| `sticky`                    | `{ position: 'relative' }` + note: use ScrollView `stickyHeaderIndices` | ✅ static-map / automated |
| `fixed`                     | `{ position: 'absolute', top:0, left:0, right:0 }` (overlay bar) | ✅ static-map / automated |
| `transition*` / `duration-*` / `ease-*` / `delay-*` | dropped (lossless — RN has no CSS transitions; state changes are instant) | ✅ static-map / automated |
| `animate-pulse`/`bounce`/`ping`/`none` | dropped with note (decorative; re-add via Reanimated if needed) | ✅ static-map / automated |

**Tier 2 — pattern** (deterministic given the parameters):

| Unsupported Tailwind        | React Native equivalent                                   | Tier / status |
| --------------------------- | --------------------------------------------------------- | ------------- |
| `hover:X` (+ responsive prefix) | NativeWind `active:X` — the pressed-state equivalent (element must be `Pressable`-backed) | ✅ pattern / automated |
| `grid grid-cols-N` (+ `gap-*`) | `flex-row flex-wrap`; each child `width 100/N %` (`w-[…]`); `gap-*` preserved | ✅ pattern / automated |
| `bg-gradient-to-DIR` + `from-`/`via-`/`to-<color>` | `expo-linear-gradient` `<LinearGradient colors start end>` — colors mapped to hex, direction → start/end points | ✅ pattern / automated |

Falls through to **tier 3 (LLM)** only when no row above matches (e.g.
`mix-blend-*`, arbitrary `[mask-…]`). Tier-3 output is markdown-stripped,
re-parsed by the codemod-worker (retry once, else `unresolvable`), and cached.

## Automated by the AI Resolution Engine — CSS Module resolver

`.module.css` → RN is a **parsing** problem, not a reasoning one: postcss (in the
Node worker) parses the stylesheet, this declarative CSS→RN table maps each
declaration, and a ts-morph rewrite flips the component's references. `CSS_MODULE`
is a **rule** — on real input it needs **zero** LLM calls. Anything with no RN
equivalent is dropped **with a warning**, never guessed.

| CSS declaration                       | React Native                                              | Tier / status |
| ------------------------------------- | -------------------------------------------------------- | ------------- |
| `box-shadow: x y blur color`          | `shadowColor` + `shadowOffset {width,height}` + `shadowRadius` + `shadowOpacity` (from rgba alpha) + `elevation` (Android) | ✅ static-map / automated |
| `:hover { … }`                        | a `<name>Pressed` variant, applied via `Pressable`'s `pressed` render-prop (same pressed-state idea as the Styling Resolver) | ✅ pattern / automated |
| `transition` / `animation`            | dropped **with warning** (no CSS transitions in RN; animate with Reanimated) | ✅ static-map / automated |
| `object-fit`                          | dropped **with warning** → use the `<Image resizeMode>` prop | ✅ static-map / automated |
| `transform: translateY(-2px) …`       | `transform: [{ translateY: -2 }, …]` (function list parsed) | ✅ static-map / automated |
| `aspect-ratio: 1 / 1`                 | `aspectRatio: 1`                                          | ✅ static-map / automated |
| `display: flex` / `block`             | dropped (lossless — RN is flex by default)               | ✅ static-map / automated |
| `background`/`background-color: <color>` | `backgroundColor` (gradients/images → warned drop)    | ✅ static-map / automated |
| `border-radius`/`width`/`padding`/… `<len>` | camelCase RN prop; `rem`/`em` → px number, `%` kept as string | ✅ static-map / automated |
| `flex-direction`/`justify-content`/`overflow`/… | camelCase RN prop, value passthrough           | ✅ static-map / automated |
| unknown property / complex selector   | dropped **with warning** — never guessed                 | ✅ static-map / automated |
| Component references                  | drop the `.module.css` import, inline `StyleSheet.create({…})` under the same name, flip `className={styles.X}` → `style={styles.X}` (ts-morph) | ✅ automated |

Only a genuinely unparseable value of a *known* RN property (e.g. a **multi-value
`box-shadow`** — which shadow wins?) is `ambiguous` and may reach the LLM tier;
without a provider it too degrades to a warned drop.

## Automated by the AI Resolution Engine — Navigation resolver

Two of three navigation residue codes are rules; the third is the one place a
real design judgment lives.

| Residue         | React Native                                                     | Tier / status |
| --------------- | ---------------------------------------------------------------- | ------------- |
| `NAV_ACTIVE` (`isActive`) | React Navigation focus state — `useIsFocused()` drives the active branch (a Tab navigator styles the active tab for free) | ✅ rule (tier 1) / automated |
| `NAV_CONTAINER` wiring (`<Outlet>`/`<Routes>`) | a **complete navigator generated from the route table**; the shared `<Layout>` shell is subsumed by it (skipped, recorded) — **no NAV_CONTAINER TODO survives** | ✅ rule (tier 2) / automated |
| Navigator **shape** (stack vs tabs vs drawer) | **genuine reasoning** — the LLM returns a validated `NavigatorSpec` (never code); our generator writes the code; surfaced to the user as a Planner question | 🧠 LLM (tier 3) — *decides shape only* |

**The tier-3 contract (the product's key pattern):** the LLM's output is a
*spec, not source*. It is parsed into a closed `NavigatorSpec`, validated against
the route table (a malformed or screen-inventing spec is rejected and retried
once, then falls back to a deterministic stack), and only the validated spec
feeds the generator. Raw LLM prose can never reach the emitted navigator. See
`ARCHITECTURE.md` → *LLM decides shape, rules write code*.

## Validated end-to-end

The Validator (`tsc --noEmit` + Metro `expo export`) runs against the emitted
project, so these rules are proven, not asserted. **The AI Resolution Engine now
runs inside emit** (see `ARCHITECTURE.md` → *Emit → resolve → validate →
repair*): CSS Modules become inline `StyleSheet`s (the `.module.css` file is
never emitted), `isActive` classNames are static-ized, and the unsupported
Tailwind residue is rewritten/cleaned — all before validation. On `sample-app`
the migrated project **type-checks (0 errors) AND Metro-bundles (`expo export`)
— a running app — with zero repair rounds**. The only residue that survives is
genuinely unresolvable (a runtime `<Link to>` → `NAV_LINK`), and it does not
break the build.

Anything the deterministic pass cannot fix goes to the **repair loop**
(`app/pipeline/repair.py`): a single targeted LLM edit per remaining error,
re-validated, at most two rounds. When touching the NativeWind / navigation
paths, re-run `pytest -m slow` to keep the gate honest.

## Legend / conventions

- **Text rule**: any bare string in JSX must be wrapped in `<Text>` in RN.
- **Flex default**: RN `flexDirection` defaults to `column`; web defaults to `row`.
  The transformer makes direction explicit (`flex` → `flex flex-row`) to
  preserve layout intent — automated.
- Rows marked **Low** confidence should generate an "Ask" item, not a silent transform.
