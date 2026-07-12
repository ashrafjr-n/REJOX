#!/usr/bin/env node
/**
 * Rejox parser-worker CLI.
 *
 *   node dist/index.js <project-path>
 *
 * Parses a React project deterministically (ts-morph) and prints the Knowledge
 * Graph as JSON to stdout. Diagnostics go to stderr. Parsing never throws for a
 * single bad file — problems become entries in the top-level `warnings` list.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Project, ts, type SourceFile } from 'ts-morph';

import { walk, toPosix } from './walk';
import { extractImports, type FileImports } from './extractors/imports';
import { extractComponents } from './extractors/components';
import {
  findHookDefinitions,
  buildHooks,
  type HookDefinition,
} from './extractors/hooks';
import { extractRoutes } from './extractors/routes';
import { extractState, storeId, type StoreDefinition } from './extractors/state';
import {
  extractApiFile,
  extractEndpoints,
  type FileApiInfo,
} from './extractors/api';
import { componentId } from './extractors/components';
import type {
  ApiClient,
  Asset,
  Component,
  Edge,
  Endpoint,
  FileNode,
  FileType,
  Hook,
  KnowledgeGraph,
  Route,
  Store,
} from './types';

const ROUTER_MODULES = new Set(['react-router-dom', 'react-router']);
const STYLE_EXT = new Set(['.css', '.scss', '.sass', '.less']);
const ASSET_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico',
  '.woff', '.woff2', '.ttf',
]);

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function countLines(abs: string): number {
  try {
    const text = fs.readFileSync(abs, 'utf8');
    if (text.length === 0) return 0;
    return text.split(/\r\n|\r|\n/).length;
  } catch {
    return 0;
  }
}

function classifyConfig(base: string): boolean {
  if (base === 'package.json') return true;
  if (/^tsconfig.*\.json$/.test(base)) return true;
  if (/\.config\.(ts|js|cjs|mjs)$/.test(base)) return true;
  return false;
}

function detectLanguage(sourceRel: string[]): 'ts' | 'js' | 'mixed' {
  const hasTs = sourceRel.some((f) => f.endsWith('.ts') || f.endsWith('.tsx'));
  const hasJs = sourceRel.some(
    (f) =>
      f.endsWith('.js') ||
      f.endsWith('.jsx') ||
      f.endsWith('.mjs') ||
      f.endsWith('.cjs'),
  );
  if (hasTs && hasJs) return 'mixed';
  if (hasTs) return 'ts';
  return 'js';
}

function main(): void {
  const projectPath = process.argv[2];
  if (!projectPath) fail('Usage: node dist/index.js <project-path>');

  const root = path.resolve(projectPath);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    fail(`Not a directory: ${root}`);
  }

  const warnings: string[] = [];
  const discovered = walk(root);
  const allFilesRel = new Set<string>([
    ...discovered.source,
    ...discovered.style,
    ...discovered.asset,
    ...discovered.other,
  ]);

  // --- ts-morph project ---------------------------------------------------
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: {
      allowJs: true,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2020,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      skipLibCheck: true,
    },
  });

  const sourceFiles: { rel: string; sf: SourceFile }[] = [];
  for (const rel of discovered.source) {
    const abs = path.join(root, rel);
    try {
      const sf = project.addSourceFileAtPath(abs);
      sourceFiles.push({ rel, sf });
    } catch (err) {
      warnings.push(`Failed to load ${rel}: ${(err as Error).message}`);
    }
  }

  // Syntactic diagnostics → warnings (graceful bad-file handling).
  const program = project.getProgram().compilerObject;
  for (const { rel, sf } of sourceFiles) {
    try {
      const diags = program.getSyntacticDiagnostics(sf.compilerNode);
      for (const d of diags) {
        const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
        warnings.push(`Syntax error in ${rel}: ${msg}`);
      }
    } catch (err) {
      warnings.push(`Diagnostics failed for ${rel}: ${(err as Error).message}`);
    }
  }

  // --- Per-file extraction ------------------------------------------------
  const importsByFile = new Map<string, FileImports>();
  const components: Component[] = [];
  const hookDefs: HookDefinition[] = [];
  const routes: Route[] = [];
  const storeDefs: StoreDefinition[] = [];
  const apiInfoByFile = new Map<string, FileApiInfo>();
  const componentFiles = new Set<string>();
  const hookFiles = new Set<string>();
  const storeFiles = new Set<string>();
  const apiFiles = new Set<string>();
  let usesZustand = false;
  let usesContext = false;

  for (const { rel, sf } of sourceFiles) {
    try {
      const imports = extractImports(sf, rel, allFilesRel);
      importsByFile.set(rel, imports);

      const comps = extractComponents(sf, rel, imports);
      if (comps.length) componentFiles.add(rel);
      components.push(...comps);

      const hooks = findHookDefinitions(sf, rel);
      if (hooks.length) hookFiles.add(rel);
      hookDefs.push(...hooks);

      const importsRouter = imports.specifiers.some((s) =>
        ROUTER_MODULES.has(s),
      );
      if (importsRouter) {
        routes.push(...extractRoutes(sf, imports));
        if (
          sf.getText().includes('createBrowserRouter') ||
          sf.getText().includes('createHashRouter')
        ) {
          warnings.push(
            `Object-config router (createBrowserRouter/createHashRouter) in ${rel} is not yet parsed; only JSX <Route> is extracted.`,
          );
        }
      }

      const state = extractState(sf, rel, imports);
      if (state.zustandStores.length) storeFiles.add(rel);
      if (state.usesZustand) usesZustand = true;
      if (state.usesContext) usesContext = true;
      storeDefs.push(...state.zustandStores);

      const apiInfo = extractApiFile(sf, rel);
      apiInfoByFile.set(rel, apiInfo);
    } catch (err) {
      warnings.push(
        `Failed to extract ${rel}: ${(err as Error).message}`,
      );
    }
  }

  // --- API endpoints (needs global knowledge of client files) -------------
  const clientFiles = new Set<string>();
  const clients: ApiClient[] = [];
  for (const [rel, info] of apiInfoByFile) {
    if (info.definesAxiosClient) clientFiles.add(rel);
    clients.push(...info.clients);
  }

  const endpoints: Endpoint[] = [];
  for (const { rel, sf } of sourceFiles) {
    const info = apiInfoByFile.get(rel);
    const imports = importsByFile.get(rel);
    if (!info || !imports) continue;

    const axiosNames = new Set<string>(info.axiosInstanceNames);
    for (const b of imports.bindings) {
      const target = imports.bindingToFile[b.local];
      if (target && clientFiles.has(target)) axiosNames.add(b.local);
    }
    if (axiosNames.size > 0 || info.usesFetch) {
      const found = extractEndpoints(sf, rel, axiosNames);
      if (found.length) apiFiles.add(rel);
      endpoints.push(...found);
    }
    if (info.definesAxiosClient || info.usesFetch) apiFiles.add(rel);
  }

  // --- Hooks (wire usedBy) ------------------------------------------------
  const hooks: Hook[] = buildHooks(hookDefs, components);

  // --- Stores (wire usedBy) -----------------------------------------------
  const stores: Store[] = storeDefs.map((def) => ({
    id: storeId(def.file, def.name),
    name: def.name,
    file: def.file,
    stateKeys: def.stateKeys,
    usedBy: components
      .filter((c) => c.hooksUsed.includes(def.name))
      .map((c) => c.name)
      .sort(),
  }));

  const stateLibrary: 'zustand' | 'context' | 'none' = usesZustand
    ? 'zustand'
    : usesContext
      ? 'context'
      : 'none';

  // --- Files classification ----------------------------------------------
  const files: FileNode[] = [];
  const addFile = (rel: string, type: FileType, loc: number) =>
    files.push({ path: rel, type, loc });

  const sfByRel = new Map(sourceFiles.map((s) => [s.rel, s.sf]));

  for (const rel of discovered.source) {
    const base = rel.split('/').pop() ?? rel;
    const sf = sfByRel.get(rel);
    const loc = sf ? sf.getEndLineNumber() : countLines(path.join(root, rel));
    let type: FileType = 'other';
    if (classifyConfig(base)) type = 'config';
    else if (componentFiles.has(rel)) type = 'component';
    else if (hookFiles.has(rel)) type = 'hook';
    else if (storeFiles.has(rel)) type = 'store';
    else if (apiFiles.has(rel)) type = 'api';
    addFile(rel, type, loc);
  }
  for (const rel of discovered.style) {
    addFile(rel, 'style', countLines(path.join(root, rel)));
  }
  for (const rel of discovered.asset) {
    addFile(rel, 'asset', 0);
  }
  for (const rel of discovered.other) {
    const base = rel.split('/').pop() ?? rel;
    const type: FileType = classifyConfig(base) ? 'config' : 'other';
    addFile(rel, type, countLines(path.join(root, rel)));
  }
  files.sort((a, b) => a.path.localeCompare(b.path));

  // --- Assets -------------------------------------------------------------
  const assetSet = new Set(discovered.asset);
  const referencedBy = new Map<string, Set<string>>();
  for (const [rel, imports] of importsByFile) {
    for (const target of Object.values(imports.localTargets)) {
      if (assetSet.has(target)) {
        if (!referencedBy.has(target)) referencedBy.set(target, new Set());
        referencedBy.get(target)!.add(rel);
      }
    }
  }
  const assets: Asset[] = discovered.asset.map((rel) => ({
    path: rel,
    type: (rel.split('.').pop() ?? '').toLowerCase(),
    referencedBy: [...(referencedBy.get(rel) ?? [])].sort(),
  }));

  // --- Edges --------------------------------------------------------------
  const edges: Edge[] = [];
  const seenEdges = new Set<string>();
  const pushEdge = (from: string, to: string, kind: Edge['kind']) => {
    const key = `${from}->${to}:${kind}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ from, to, kind });
  };

  // imports
  for (const [rel, imports] of importsByFile) {
    for (const target of Object.values(imports.localTargets)) {
      pushEdge(rel, target, 'imports');
    }
  }

  // renders / uses-hook / uses-store
  const componentsByFile = new Map<string, Component[]>();
  for (const c of components) {
    if (!componentsByFile.has(c.file)) componentsByFile.set(c.file, []);
    componentsByFile.get(c.file)!.push(c);
  }
  const hookByName = new Map(hooks.map((h) => [h.name, h]));
  const storeByName = new Map(stores.map((s) => [s.name, s]));

  for (const c of components) {
    const imports = importsByFile.get(c.file);
    for (const child of c.childComponents) {
      const targetFile = imports?.bindingToFile[child];
      if (!targetFile) continue;
      const match = (componentsByFile.get(targetFile) ?? []).find(
        (x) => x.name === child,
      );
      if (match) pushEdge(c.id, match.id, 'renders');
    }
    for (const used of c.hooksUsed) {
      const hook = hookByName.get(used);
      if (hook) pushEdge(c.id, hook.id, 'uses-hook');
      const store = storeByName.get(used);
      if (store) pushEdge(c.id, store.id, 'uses-store');
    }
  }

  // calls-api — only for files that actually call an endpoint.
  const endpointFiles = new Set(endpoints.map((e) => e.file));
  for (const rel of endpointFiles) {
    const imports = importsByFile.get(rel);
    let linked = false;
    if (imports) {
      for (const b of imports.bindings) {
        const target = imports.bindingToFile[b.local];
        if (target && clientFiles.has(target)) {
          pushEdge(rel, target, 'calls-api');
          linked = true;
        }
      }
    }
    // Endpoints via an in-file axios.create or fetch: link the file to itself.
    if (!linked) pushEdge(rel, rel, 'calls-api');
  }

  // --- Project ------------------------------------------------------------
  let pkg: Record<string, unknown> = {};
  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch (err) {
      warnings.push(`Failed to parse package.json: ${(err as Error).message}`);
    }
  }
  const deps = (pkg.dependencies as Record<string, string>) ?? {};
  const hasVite =
    discovered.source.some((f) => /(^|\/)vite\.config\.(ts|js)$/.test(f)) ||
    'vite' in ((pkg.devDependencies as Record<string, string>) ?? {});

  const graph: KnowledgeGraph = {
    project: {
      name: (pkg.name as string) ?? path.basename(root),
      root,
      framework: 'react',
      language: detectLanguage(discovered.source),
      bundler: hasVite ? 'vite' : null,
      dependencies: deps,
    },
    files,
    components,
    hooks,
    routes,
    stateManagement: { library: stateLibrary, stores },
    apiLayer: { clients, endpoints },
    assets,
    edges,
    warnings,
  };

  process.stdout.write(JSON.stringify(graph, null, 2));
}

try {
  main();
} catch (err) {
  fail(`parser-worker crashed: ${(err as Error).stack ?? String(err)}`);
}
