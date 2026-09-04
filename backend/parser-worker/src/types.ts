/**
 * TypeScript mirror of the Knowledge Graph schema.
 * Keep in sync with backend/app/models/knowledge_graph.py.
 */

export type FileType =
  | 'component'
  | 'hook'
  | 'store'
  | 'api'
  | 'style'
  | 'config'
  | 'asset'
  | 'other';

export type StylingApproach = 'tailwind' | 'css-module' | 'inline' | 'none';

export type EdgeKind =
  | 'renders'
  | 'imports'
  | 'uses-hook'
  | 'uses-store'
  | 'calls-api';

export interface Project {
  name: string;
  root: string;
  framework: 'react';
  language: 'ts' | 'js' | 'mixed';
  bundler: string | null;
  dependencies: Record<string, string>;
}

export interface FileNode {
  path: string;
  type: FileType;
  loc: number;
}

export interface PropInfo {
  name: string;
  type: string | null;
  optional: boolean;
}

/** A raw text / expression child in JSX (conversion fact). */
export interface TextNodeInfo {
  jsxParentTag: string;
  /** Static text, or the literal string "dynamic" for an expression child. */
  text: string;
  /** True when the text is not already inside a text-ish element (needs <Text>). */
  isBare: boolean;
}

/** Flex/grid layout info for one element (conversion fact). */
export interface LayoutHint {
  elementTag: string;
  hasFlexClass: boolean;
  flexDirection: 'row' | 'column' | null;
  isGrid: boolean;
}

/** Info about one <img> (conversion fact). */
export interface ImageInfo {
  hasExplicitSize: boolean;
  srcKind: 'import' | 'literal' | 'dynamic';
  src: string | null;
}

/** An element carrying an inline style object (conversion fact). */
export interface InlineStyleInfo {
  elementTag: string;
  properties: string[];
}

export interface Component {
  id: string;
  name: string;
  file: string;
  exportType: 'default' | 'named';
  props: PropInfo[];
  /**
   * Base type names the props interface/alias extends (e.g.
   * "ButtonHTMLAttributes"), without type arguments. Lets later stages resolve
   * inherited DOM props (onClick, className, ...) from the graph.
   */
  propsExtends: string[];
  hooksUsed: string[];
  childComponents: string[];
  jsxElements: Record<string, number>;
  eventHandlers: string[];
  stylingApproach: StylingApproach[];
  tailwindClasses: string[];
  cssModuleImports: string[];
  /** Browser globals referenced (localStorage, window, document, ...). */
  webApis: string[];
  // --- Conversion facts (feed the Deterministic Transformer) ---
  textNodes: TextNodeInfo[];
  layoutHints: LayoutHint[];
  images: ImageInfo[];
  inlineStyles: InlineStyleInfo[];
}

export interface Hook {
  id: string;
  name: string;
  file: string;
  isCustom: boolean;
  usedBy: string[];
}

/** One prop on a route's element, and the binding it reads (when it is one). */
export interface RouteElementProp {
  name: string;
  /** The identifier the prop reads (`darkMode={darkMode}` → `darkMode`), or
   *  null when the value is any richer expression — those cannot be hoisted. */
  binding: string | null;
}

/** A `const [value, setter] = useState(initializer)` in the routing component. */
export interface RouteHostState {
  value: string;
  setter: string | null;
  initializer: string;
}

export interface Route {
  path: string | null;
  componentName: string | null;
  file: string | null;
  hasParams: boolean;
  params: string[];
  /**
   * Props the route's element passes to its component
   * (`<Route element={<Settings darkMode={x} />}>`).
   *
   * A `Screen` registers a component, not an element, so these have nowhere to
   * travel — the navigator generator has to answer for them rather than drop
   * them on the floor.
   */
  elementProps: RouteElementProp[];
  /**
   * State declared by the component that renders this `<Route>`. React Router
   * lets that component thread its state into the element; a navigator has no
   * such seam, so the generator hoists these declarations into `AppNavigator`
   * — which is what that component's routing half becomes.
   */
  hostState: RouteHostState[];
}

export interface Store {
  id: string;
  name: string;
  file: string;
  stateKeys: string[];
  usedBy: string[];
}

export interface StateManagement {
  library: 'zustand' | 'context' | 'none';
  stores: Store[];
}

export interface ApiClient {
  id: string;
  library: 'axios' | 'fetch';
  file: string;
  baseURL: string | null;
}

export interface Endpoint {
  method: string | null;
  url: string | null;
  file: string;
}

export interface ApiLayer {
  clients: ApiClient[];
  endpoints: Endpoint[];
}

export interface Asset {
  path: string;
  type: string;
  referencedBy: string[];
}

export interface Edge {
  from: string;
  to: string;
  kind: EdgeKind;
}

/**
 * One value the lifted provider chain reads and the entry file supplied —
 * either an import, or a top-level declaration written in the entry file.
 */
export interface EntryBinding {
  /** Local name bound (e.g. `store`, `queryClient`). */
  local: string;
  /** Import: the module specifier as written (`react-redux`, `./services/store`). */
  module: string | null;
  /** Import: the exported name (`default`, `*`, or a named export). */
  imported: string | null;
  /** Import of a same-project file: the project-relative path it resolves to. */
  resolvedFile: string | null;
  /** Declaration: its full source text, verbatim (`const q = new QueryClient()`). */
  declaration: string | null;
}

/** One provider wrapping the root component, as written in the entry file. */
export interface RootProvider {
  /** Tag as written, e.g. `Provider` or `Theme.Provider`. */
  tag: string;
  /** Attributes as source text, in order, e.g. [`store={store}`]. */
  attributes: string[];
  /** Local names the tag and its attributes reference. */
  references: string[];
}

/**
 * The web entry file (`src/main.*` / `src/index.*`) — the one file whose whole
 * job (mount into a DOM node) has no React Native equivalent, and which is
 * therefore never emitted. What it configured ABOVE the root component still
 * belongs to the app, so it is extracted here rather than lost with the file.
 */
export interface EntryPoint {
  /** Project-relative path of the entry file. */
  file: string;
  /** Local name the root component was bound to (`App`), when resolvable. */
  rootComponent: string | null;
  /** The file that root component came from, project-relative. */
  rootComponentFile: string | null;
  /** Providers wrapping the root component, outermost first. */
  providers: RootProvider[];
  /** Values the providers reference, in the order they must be emitted. */
  bindings: EntryBinding[];
  /** Wrappers deliberately not lifted, as `<tag>: <reason>`. */
  dropped: string[];
  /** Anything the extraction could not resolve — never silently ignored. */
  warnings: string[];
}

export interface KnowledgeGraph {
  project: Project;
  files: FileNode[];
  components: Component[];
  hooks: Hook[];
  routes: Route[];
  stateManagement: StateManagement;
  apiLayer: ApiLayer;
  assets: Asset[];
  edges: Edge[];
  entry: EntryPoint | null;
  warnings: string[];
}
