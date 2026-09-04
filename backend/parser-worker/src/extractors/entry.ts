/**
 * Web entry-point extraction (`src/main.*` / `src/index.*`).
 *
 * The entry file is the one file whose whole job — mounting a React tree into a
 * DOM node — has no React Native equivalent, so it is never emitted. But what it
 * wraps AROUND the root component is not DOM plumbing: a Redux `<Provider>`, a
 * `<QueryClientProvider>`, a theme provider are app-level configuration, and
 * dropping them with the file is how a migrated app loses its store and throws
 * on the first hook that reads it.
 *
 * This extractor reads that chain deterministically (ts-morph) so `emit` can
 * rebuild it above the RN root. It reports what it could NOT resolve rather
 * than guessing — an unresolvable binding is a warning, never an invention.
 */

import { Node, SyntaxKind, type SourceFile } from 'ts-morph';
import type { EntryBinding, EntryPoint, RootProvider } from '../types';
import type { FileImports } from './imports';

/** Entry-file stems, in the order a project is searched. */
const ENTRY_STEMS = ['src/main', 'src/index'];
const ENTRY_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js'];

/** Modules whose providers the generated navigator subsumes. */
const ROUTER_MODULES = new Set(['react-router-dom', 'react-router']);

/**
 * Wrappers that carry no app configuration of their own. `StrictMode` is a
 * React-internal development wrapper and `Fragment` is nothing at all — lifting
 * either into the RN root would carry over noise, not behaviour.
 */
const STATELESS_WRAPPERS = new Set([
  'StrictMode',
  'React.StrictMode',
  'Fragment',
  'React.Fragment',
]);

/** The project-relative entry file of this project, or null. */
export function findEntryFile(allFilesRel: Set<string>): string | null {
  for (const stem of ENTRY_STEMS) {
    for (const ext of ENTRY_EXTENSIONS) {
      const candidate = `${stem}${ext}`;
      if (allFilesRel.has(candidate)) return candidate;
    }
  }
  return null;
}

/** The JSX argument of `createRoot(…).render(<x/>)` or `ReactDOM.render(<x/>, …)`. */
function rootRenderArgument(sourceFile: SourceFile): Node | null {
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    if (callee.getName() !== 'render') continue;
    const [first] = call.getArguments();
    if (first && (Node.isJsxElement(first) || Node.isJsxSelfClosingElement(first))) {
      return first;
    }
  }
  return null;
}

/** The tag name of a JSX element, self-closing or not. */
function tagNameOf(element: Node): string {
  const tag = Node.isJsxElement(element) ? element.getOpeningElement() : element;
  if (!Node.isJsxOpeningElement(tag) && !Node.isJsxSelfClosingElement(tag)) return '';
  return tag.getTagNameNode().getText();
}

/** The leftmost identifier of a tag name — `Theme.Provider` references `Theme`. */
function rootIdentifier(tagName: string): string {
  return tagName.split('.')[0];
}

/**
 * Walk down the wrapper chain from the rendered element, collecting each
 * wrapper and stopping at the innermost element — the root component.
 *
 * A wrapper with more than one child element is not a provider chain at all;
 * the walk stops there and the caller records it, because guessing which child
 * is "the app" is exactly the kind of judgment this layer must not make.
 */
function walkChain(root: Node): { chain: Node[]; leaf: Node | null; ambiguous: boolean } {
  const chain: Node[] = [];
  let current: Node | null = root;

  while (current) {
    if (Node.isJsxSelfClosingElement(current)) return { chain, leaf: current, ambiguous: false };
    if (!Node.isJsxElement(current)) return { chain, leaf: null, ambiguous: false };

    const children: Node[] = current
      .getJsxChildren()
      .filter((c: Node) => Node.isJsxElement(c) || Node.isJsxSelfClosingElement(c));

    if (children.length !== 1) {
      return { chain, leaf: null, ambiguous: children.length > 1 };
    }
    chain.push(current);
    current = children[0];
  }
  return { chain, leaf: null, ambiguous: false };
}

/** Attribute source texts plus every local name they reference. */
function attributesOf(tag: Node): { attributes: string[]; references: string[] } {
  const attributes: string[] = [];
  const references = new Set<string>();
  if (!Node.isJsxOpeningElement(tag) && !Node.isJsxSelfClosingElement(tag)) {
    return { attributes, references: [] };
  }
  for (const attr of tag.getAttributes()) {
    attributes.push(attr.getText());
    for (const id of attr.getDescendantsOfKind(SyntaxKind.Identifier)) {
      // A property name (`a` in `x.a`) is not a binding this file supplies.
      const parent = id.getParent();
      if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === id) continue;
      references.add(id.getText());
    }
  }
  return { attributes, references: [...references] };
}

/** Top-level `const/let/var` statements of the entry file, by bound name. */
function topLevelDeclarations(sourceFile: SourceFile): Map<string, string> {
  const found = new Map<string, string>();
  for (const statement of sourceFile.getVariableStatements()) {
    for (const decl of statement.getDeclarations()) {
      const name = decl.getNameNode();
      if (Node.isIdentifier(name)) found.set(name.getText(), statement.getText());
    }
  }
  return found;
}

/**
 * Resolve every name the chain reads to the binding that supplies it, following
 * declarations to the names THEY read until nothing new appears (a declaration
 * may itself read an import: `const q = new QueryClient()`).
 */
function resolveBindings(
  needed: string[],
  imports: FileImports,
  declarations: Map<string, string>,
  sourceFile: SourceFile,
): { bindings: EntryBinding[]; warnings: string[] } {
  const byLocal = new Map(imports.bindings.map((b) => [b.local, b]));
  const moduleOf = new Map<string, string>();
  for (const imp of sourceFile.getImportDeclarations()) {
    const specifier = imp.getModuleSpecifierValue();
    const def = imp.getDefaultImport();
    if (def) moduleOf.set(def.getText(), specifier);
    const ns = imp.getNamespaceImport();
    if (ns) moduleOf.set(ns.getText(), specifier);
    for (const named of imp.getNamedImports()) {
      moduleOf.set(named.getAliasNode()?.getText() ?? named.getName(), specifier);
    }
  }

  const bindings: EntryBinding[] = [];
  const warnings: string[] = [];
  const emitted = new Set<string>();
  const queue = [...needed];

  while (queue.length) {
    const local = queue.shift() as string;
    if (emitted.has(local)) continue;
    emitted.add(local);

    const imported = byLocal.get(local);
    if (imported) {
      const module = moduleOf.get(local) ?? null;
      bindings.push({
        local,
        module,
        imported: imported.imported,
        resolvedFile: (module && imports.localTargets[module]) || null,
        declaration: null,
      });
      continue;
    }

    const declaration = declarations.get(local);
    if (declaration) {
      bindings.push({ local, module: null, imported: null, resolvedFile: null, declaration });
      // The declaration may read further names of its own.
      const statement = sourceFile
        .getVariableStatements()
        .find((s) => s.getText() === declaration);
      for (const id of statement?.getDescendantsOfKind(SyntaxKind.Identifier) ?? []) {
        const parent = id.getParent();
        if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === id) continue;
        if (id.getText() !== local) queue.push(id.getText());
      }
      continue;
    }

    warnings.push(
      `entry: '${local}' is read by a root provider but is neither imported nor ` +
        `declared in the entry file; it was not carried into App.tsx`,
    );
  }

  // Declarations must be written after the imports they read, and imports of a
  // declaration are discovered only once the declaration is seen.
  bindings.sort((a, b) => Number(a.declaration !== null) - Number(b.declaration !== null));
  return { bindings, warnings };
}

/**
 * Extract the entry point's provider chain. Returns null when the file has no
 * recognizable root render — an entry we cannot read is reported by the caller,
 * never approximated.
 */
export function extractEntryPoint(
  sourceFile: SourceFile,
  fileRel: string,
  imports: FileImports,
): EntryPoint {
  const entry: EntryPoint = {
    file: fileRel,
    rootComponent: null,
    rootComponentFile: null,
    providers: [],
    bindings: [],
    dropped: [],
    warnings: [],
  };

  const rendered = rootRenderArgument(sourceFile);
  if (!rendered) {
    entry.warnings.push(
      'entry: no createRoot(…).render(<…/>) call found; nothing was lifted from it',
    );
    return entry;
  }

  const { chain, leaf, ambiguous } = walkChain(rendered);
  if (ambiguous) {
    entry.warnings.push(
      'entry: a root wrapper has more than one element child; the root component ' +
        'is not identifiable, so no provider was lifted',
    );
    return entry;
  }
  if (!leaf) {
    entry.warnings.push('entry: the rendered tree has no single root component');
    return entry;
  }

  const leafTag = tagNameOf(leaf);
  entry.rootComponent = leafTag;
  entry.rootComponentFile = imports.bindingToFile[rootIdentifier(leafTag)] ?? null;

  const referenced = new Set<string>();
  for (const element of chain) {
    const tag = Node.isJsxElement(element) ? element.getOpeningElement() : element;
    const tagName = tagNameOf(element);

    if (STATELESS_WRAPPERS.has(tagName)) {
      entry.dropped.push(`${tagName}: a stateless wrapper carries no app configuration`);
      continue;
    }

    const owningModule = moduleForBinding(sourceFile, rootIdentifier(tagName));
    if (owningModule && ROUTER_MODULES.has(owningModule)) {
      entry.dropped.push(`${tagName}: router provider, subsumed by the generated navigator`);
      continue;
    }

    const { attributes, references } = attributesOf(tag);
    references.push(rootIdentifier(tagName));
    for (const r of references) referenced.add(r);
    entry.providers.push({ tag: tagName, attributes, references });
  }

  const { bindings, warnings } = resolveBindings(
    [...referenced],
    imports,
    topLevelDeclarations(sourceFile),
    sourceFile,
  );
  entry.bindings = bindings;
  entry.warnings.push(...warnings);
  return entry;
}

/** The module specifier a local name was imported from, or null. */
function moduleForBinding(sourceFile: SourceFile, local: string): string | null {
  for (const imp of sourceFile.getImportDeclarations()) {
    const specifier = imp.getModuleSpecifierValue();
    if (imp.getDefaultImport()?.getText() === local) return specifier;
    if (imp.getNamespaceImport()?.getText() === local) return specifier;
    for (const named of imp.getNamedImports()) {
      if ((named.getAliasNode()?.getText() ?? named.getName()) === local) return specifier;
    }
  }
  return null;
}
