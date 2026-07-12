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

/** react-router hooks that need React Navigation equivalents (Part 2). */
export const ROUTER_HOOKS = new Set([
  'useParams', 'useNavigate', 'useLocation', 'useSearchParams', 'useMatch',
  'useRoutes', 'useOutletContext',
]);
