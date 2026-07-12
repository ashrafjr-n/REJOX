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

export interface Component {
  id: string;
  name: string;
  file: string;
  exportType: 'default' | 'named';
  props: PropInfo[];
  hooksUsed: string[];
  childComponents: string[];
  jsxElements: Record<string, number>;
  eventHandlers: string[];
  stylingApproach: StylingApproach[];
  tailwindClasses: string[];
  cssModuleImports: string[];
  /** Browser globals referenced (localStorage, window, document, ...). */
  webApis: string[];
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
