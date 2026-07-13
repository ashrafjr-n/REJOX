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
| `react-router-dom`                | React Navigation (`@react-navigation/*`)    | Medium     | `Link`→`navigation.navigate` and `useParams`→`useRoute` are **automated** (route table); navigator STRUCTURE (stack/tab) stays a design decision. |
| CSS `:hover`                      | — (no equivalent)                           | Low        | No hover on touch. Flag; optionally map to press/focus state. |
| `localStorage`                    | `AsyncStorage` (`@react-native-async-storage`) | Medium  | API is async — call sites must be awaited. |
| `<a href>`                        | `Linking.openURL` / `<Pressable>`           | Medium     | External links → `Linking`; internal → navigation. |
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
| NativeWind-supported Tailwind classes           | **passed through untouched** (the mechanical majority) | ✅ High / automated |
| `space-x-*`/`space-y-*` → `gap-x-*`/`gap-y-*`   | class rename (child-selector spacing → flex gap)     | ✅ High / automated |
| `flex` with no direction → append `flex-row`    | web defaults to row, RN to column — direction made explicit | ✅ High / automated |
| Inject `import { … } from 'react-native'` / `'@react-navigation/native'` | for everything actually used | ✅ High / automated |
| Drop `react-dom` imports                        | import removal                                       | ✅ High / automated |

**The honest residue (`unhandled` → AI Resolution Engine)** — only what
genuinely requires judgment; every item also leaves a `// REJOX-TODO(<CODE>)`
comment so nothing is ever silently dropped:

| Residue code    | What it is                                                       | Why it needs reasoning |
| --------------- | ---------------------------------------------------------------- | ---------------------- |
| `NAV_LINK`      | `to` is a runtime expression with no static route-table match    | which screen is a runtime value |
| `NAV_ACTIVE`    | `NavLink` styles by `isActive`                                   | active state is navigation state; tab bar vs highlight is design |
| `NAV_CONTAINER` | `<Routes>`/`<Route>`/`<Outlet>` structure                        | navigator arrangement (stack/tab/drawer) is design |
| `NAV_HOOK`      | router hooks other than `useParams` still referenced             | imperative navigation intent |
| `CSS_MODULE`    | `*.module.css` imports                                           | restyling a stylesheet is design |
| `TW_UNSUPPORTED`| `hover:`/`group-*`/`grid-*`/gradients/`backdrop-*`/transitions/animations/`sticky`/`fixed`/`divide-*` | no RN equivalent; re-expression (pressed state, flex reflow, expo-linear-gradient, Moti) is design |
| `EVENT_ADAPTER` | `onChangeText` handler now receives a string                     | handler body may need reshaping |
| `FORM_SUBMIT`   | `onSubmit` semantics                                             | submission flow must move into state |
| `PROPS_HTML_TYPE` | DOM types with no clean RN equivalent (post-map)               | props API redesign |
| `WEB_ONLY_ELEMENT` | `table`/`canvas`/`iframe`/…                                   | needs a component redesign |

## Legend / conventions

- **Text rule**: any bare string in JSX must be wrapped in `<Text>` in RN.
- **Flex default**: RN `flexDirection` defaults to `column`; web defaults to `row`.
  The transformer makes direction explicit (`flex` → `flex flex-row`) to
  preserve layout intent — automated.
- Rows marked **Low** confidence should generate an "Ask" item, not a silent transform.
