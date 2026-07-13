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

export interface Route {
  path: string | null;
  componentName: string | null;
  file: string | null;
  hasParams: boolean;
  params: string[];
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
  warnings: string[];
}
