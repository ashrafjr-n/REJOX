/** Types for the codemod worker. */

/** One row of the resolved route table (from the Project Intelligence Engine). */
export interface RouteOption {
  /** Normalized absolute web path, e.g. "/products/:id". */
  path: string;
  /** React Navigation screen name, e.g. "ProductDetail". */
  screen: string;
  /** Param names in path order, e.g. ["id"]. */
  params: string[];
}

/** Answered Ask-stage options + graph-derived facts that steer the transform. */
export interface Options {
  projectType?: string;
  stylingEngine?: string;
  navigationLibrary?: string;
  /** Route table: lets `<Link to>` resolve to navigation.navigate() deterministically. */
  routes?: RouteOption[];
  /**
   * Graph-resolved event renames on PROJECT components, e.g.
   * `{ "Button": { "onClick": "onPress" } }` (Button's props extend a DOM
   * attributes interface, so its onClick is the DOM event).
   */
  componentEvents?: Record<string, Record<string, string>>;
  [key: string]: unknown;
}

export interface Warning {
  code: string;
  message: string;
  line: number;
}

/** Something rules could not safely resolve — AI Resolution Engine residue. */
export interface Unhandled {
  code: string;
  snippet: string;
}

export interface ConvertResult {
  file: string;
  code: string;
  warnings: Warning[];
  unhandled: Unhandled[];
}

/** Mutable state threaded through the transforms. */
export interface Ctx {
  options: Options;
  warnings: Warning[];
  unhandled: Unhandled[];
  /** TODO lines rendered into the output header block. */
  todos: { code: string; message: string }[];
  /** RN components that must be imported from 'react-native'. */
  rnUsed: Set<string>;
  /** module specifier → named imports to inject (e.g. @react-navigation/native). */
  namedImports: Map<string, Set<string>>;
}
