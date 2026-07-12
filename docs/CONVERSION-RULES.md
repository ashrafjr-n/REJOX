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
| `react-router-dom`                | React Navigation (`@react-navigation/*`)    | Medium     | Routes → stack/tab navigators; `useParams`→route params; `Link`→`navigation.navigate`. |
| CSS `:hover`                      | — (no equivalent)                           | Low        | No hover on touch. Flag; optionally map to press/focus state. |
| `localStorage`                    | `AsyncStorage` (`@react-native-async-storage`) | Medium  | API is async — call sites must be awaited. |
| `<a href>`                        | `Linking.openURL` / `<Pressable>`           | Medium     | External links → `Linking`; internal → navigation. |
| `<input>`                         | `<TextInput>`                               | High       | `onChange`→`onChangeText`; `value` prop preserved. |
| `<button>`                        | `<Pressable>` / `<Button>`                  | High       | Prefer `Pressable` for custom styling. |
| `<ul>` / `<ol>` / `<li>`          | `<FlatList>` / `<View>` + `<Text>`          | Medium     | Long/dynamic lists → `FlatList`; small static → mapped Views. |
| CSS `display: flex`               | `flex` (default in RN)                       | High       | RN is flexbox by default; `flexDirection` defaults to `column`, not `row`. |
| CSS responsive grid / media query | `Dimensions` / `useWindowDimensions`         | Low        | No CSS grid or media queries; requires manual/LLM-assisted reflow. |

## Legend / conventions

- **Text rule**: any bare string in JSX must be wrapped in `<Text>` in RN.
- **Flex default**: RN `flexDirection` defaults to `column`; web defaults to `row`.
  Converters must make direction explicit to preserve layout intent.
- Rows marked **Low** confidence should generate an "Ask" item, not a silent transform.
