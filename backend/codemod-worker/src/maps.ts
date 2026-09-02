/**
 * Declarative element / event maps — the single source of truth for the
 * mechanical React → React Native renames. Mirrors docs/CONVERSION-RULES.md.
 */

/** Host element → RN component. */
export const ELEMENT_MAP: Record<string, string> = {
  // Containers → View
  div: 'View', section: 'View', header: 'View', footer: 'View', nav: 'View',
  main: 'View', article: 'View', aside: 'View', ul: 'View', ol: 'View',
  li: 'View', form: 'View', figure: 'View',
  // Text → Text
  span: 'Text', p: 'Text', h1: 'Text', h2: 'Text', h3: 'Text', h4: 'Text',
  h5: 'Text', h6: 'Text', label: 'Text', small: 'Text', strong: 'Text',
  em: 'Text', b: 'Text', i: 'Text', figcaption: 'Text', blockquote: 'Text',
  // Media / interactive
  img: 'Image',
  button: 'Pressable',
  a: 'Pressable',
  input: 'TextInput',
  textarea: 'TextInput',
};

/** RN Text component name (host tags mapped here are already-wrapped text). */
export const TEXT_RN = 'Text';

/** Every RN component the codemod can emit → import from 'react-native'. */
export const RN_COMPONENTS = new Set([
  'View', 'Text', 'Image', 'Pressable', 'TextInput', 'ScrollView', 'FlatList',
]);

/** Web-only host elements with no RN equivalent — left as-is + flagged. */
export const WEB_ONLY_ELEMENTS = new Set([
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
  'canvas', 'iframe', 'embed', 'object', 'video', 'audio', 'svg', 'select',
]);

/** Web events that are dropped (no touch equivalent). */
export const WEB_ONLY_EVENTS = new Set([
  'onMouseEnter', 'onMouseLeave', 'onMouseOver', 'onMouseOut', 'onMouseMove',
  'onDoubleClick', 'onContextMenu', 'onWheel', 'onKeyDown', 'onKeyUp',
  'onKeyPress', 'onScroll',
]);

/**
 * DOM-only attributes that must not survive a tag rename, keyed by the HOST tag
 * they appear on (this runs before the rename, while tags are still lowercase).
 *
 * These carry no behaviour into RN — the mapped component simply has no such
 * prop — so leaving them on is a `tsc` error and nothing else. `href` is
 * deliberately absent: `<a>` already emits a Linking TODO that points the reader
 * at the href, so removing it would delete the very thing the TODO refers to.
 */
export const WEB_ONLY_ATTRIBUTES: Record<string, ReadonlySet<string>> = {
  button: new Set(['type']),
  label: new Set(['htmlFor']),
  a: new Set(['target', 'rel', 'download']),
};

/** react-router hooks that need React Navigation equivalents. */
export const ROUTER_HOOKS = new Set([
  'useParams', 'useNavigate', 'useLocation', 'useSearchParams', 'useMatch',
  'useRoutes', 'useOutletContext',
]);
