/** Shared helpers for the transforms. */

import {
  Node,
  SyntaxKind,
  type JsxAttribute,
  type JsxElement,
  type JsxSelfClosingElement,
  type JsxOpeningElement,
  type Identifier,
  type SourceFile,
} from 'ts-morph';
import type { Ctx } from './types';

export type JsxTagLike = JsxElement | JsxSelfClosingElement;

export function isHostTag(tag: string): boolean {
  const first = tag[0] ?? '';
  return first === first.toLowerCase() && /[a-z]/.test(first);
}

/** The opening element of a JSX element (or the self-closing element itself). */
export function openingOf(el: JsxTagLike): JsxOpeningElement | JsxSelfClosingElement {
  return Node.isJsxElement(el) ? el.getOpeningElement() : el;
}

export function tagNameOf(el: JsxTagLike): string {
  return openingOf(el).getTagNameNode().getText();
}

export function getAttr(
  el: JsxOpeningElement | JsxSelfClosingElement,
  name: string,
): JsxAttribute | undefined {
  for (const attr of el.getAttributes()) {
    if (Node.isJsxAttribute(attr) && attr.getNameNode().getText() === name) {
      return attr;
    }
  }
  return undefined;
}

export function hasAttr(
  el: JsxOpeningElement | JsxSelfClosingElement,
  name: string,
): boolean {
  return getAttr(el, name) !== undefined;
}

/** Rename a JSX element's tag (both opening and closing when present). */
export function renameTag(el: JsxTagLike, newTag: string): void {
  if (Node.isJsxSelfClosingElement(el)) {
    el.getTagNameNode().replaceWithText(newTag);
    return;
  }
  const closing = el.getClosingElement();
  el.getOpeningElement().getTagNameNode().replaceWithText(newTag);
  closing.getTagNameNode().replaceWithText(newTag);
}

/** Does this node's subtree contain any JSX element/fragment? */
export function containsJsx(node: Node): boolean {
  return (
    node.getFirstDescendantByKind(SyntaxKind.JsxElement) !== undefined ||
    node.getFirstDescendantByKind(SyntaxKind.JsxSelfClosingElement) !== undefined ||
    node.getFirstDescendantByKind(SyntaxKind.JsxFragment) !== undefined
  );
}

/** Request a named import (injected by the imports transform, de-duplicated). */
export function requestNamedImport(ctx: Ctx, module: string, name: string): void {
  let names = ctx.namedImports.get(module);
  if (!names) {
    names = new Set();
    ctx.namedImports.set(module, names);
  }
  names.add(name);
}

/** Objects that carry a browser global as a property (`window.localStorage`). */
export const GLOBAL_HOSTS = new Set(['window', 'globalThis', 'self', 'global']);

/**
 * Does the file declare `name` itself? Then every bare use is that local
 * binding, not the browser global, and treating it as one would be wrong in
 * both directions — rewriting working code, or flagging it as a bug.
 */
export function declaresName(sf: SourceFile, name: string): boolean {
  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (decl.getNameNode().getText() === name) return true;
  }
  for (const param of sf.getDescendantsOfKind(SyntaxKind.Parameter)) {
    if (param.getNameNode().getText() === name) return true;
  }
  for (const spec of sf.getDescendantsOfKind(SyntaxKind.ImportSpecifier)) {
    if (spec.getName() === name) return true;
  }
  // Destructuring binds names too — `({ location })` as a prop, or
  // `const { history } = useRouter()`. Missing these was a false positive on
  // every component with a prop sharing a browser global's name.
  for (const el of sf.getDescendantsOfKind(SyntaxKind.BindingElement)) {
    if (el.getNameNode().getText() === name) return true;
  }
  for (const fn of sf.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
    if (fn.getName() === name) return true;
  }
  return false;
}

/**
 * Is this identifier a real read of a browser global, rather than a name that
 * merely looks like one? Excludes object keys, declaration names, imported
 * bindings, and type members — `{ location: string }` describes a shape, and a
 * type annotation is not a use of anything at runtime.
 *
 * A property access is deliberately NOT decided here: `window.location` is the
 * global and `router.location` is not, and only the caller knows whether it
 * cares about the host. `propertyHost` reports it instead.
 */
export function isGlobalIdentifier(id: Identifier): boolean {
  const parent = id.getParent();
  if (!parent) return false;
  if (Node.isPropertyAssignment(parent) && parent.getNameNode() === id) return false;
  if (Node.isPropertySignature(parent) && parent.getNameNode() === id) return false;
  if (Node.isMethodSignature(parent) && parent.getNameNode() === id) return false;
  if (Node.isVariableDeclaration(parent) && parent.getNameNode() === id) return false;
  if (Node.isParameterDeclaration(parent) && parent.getNameNode() === id) return false;
  if (Node.isBindingElement(parent) && parent.getNameNode() === id) return false;
  if (id.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)) return false;
  if (
    id.getFirstAncestorByKind(SyntaxKind.TypeLiteral) ||
    id.getFirstAncestorByKind(SyntaxKind.InterfaceDeclaration) ||
    id.getFirstAncestorByKind(SyntaxKind.TypeAliasDeclaration)
  ) {
    return false;
  }
  return true;
}

/**
 * When `id` is the property half of `X.id`, the text of `X`; otherwise
 * undefined. Lets a caller tell `window.localStorage` (the global) from
 * `db.localStorage` (somebody's field).
 */
export function propertyHost(id: Identifier): string | undefined {
  const parent = id.getParent();
  if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === id) {
    return parent.getExpression().getText();
  }
  return undefined;
}

/** Request a default import (injected by the imports transform). */
export function requestDefaultImport(ctx: Ctx, module: string, name: string): void {
  ctx.defaultImports.set(module, name);
}

/**
 * A binding name not already taken anywhere in `sf`.
 *
 * An injected binding (`AsyncStorage`, `storage`, the async wrapper inside an
 * effect) is a name WE choose, dropped into a file someone else wrote. Reusing
 * a name the file already has does not fail — it shadows, and the original
 * value silently disappears at every later use. So the preferred name is taken
 * only when the file proves it is free.
 */
export function freshName(sf: SourceFile, preferred: string): string {
  const taken = new Set(
    sf.getDescendantsOfKind(SyntaxKind.Identifier).map((id) => id.getText()),
  );
  if (!taken.has(preferred)) return preferred;
  for (let i = 2; ; i++) {
    const candidate = `${preferred}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * The block body of the component function enclosing `node`, so hooks (e.g.
 * `const navigation = useNavigation()`) can be injected. Returns undefined for
 * expression-body arrows — those cannot take a statement without a rewrite.
 */
export function enclosingComponentBody(node: Node) {
  const fn =
    node.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) ??
    node.getFirstAncestorByKind(SyntaxKind.FunctionExpression) ??
    node.getFirstAncestorByKind(SyntaxKind.ArrowFunction);
  const body = fn?.getBody();
  return body && Node.isBlock(body) ? body : undefined;
}

/**
 * Make arbitrary source-derived text safe to embed in a generated comment.
 *
 * `recordUnhandled`/`recordWarning` messages, and the NAV_LINK inline note,
 * often quote a raw attribute value's `.getText()` verbatim. That text is
 * whatever the original author wrote — including, in a real repo, a JSX
 * string attribute spanning a literal newline (`to="/foo\n  "`, valid JSX).
 * Spliced raw into a `// ...` comment, an embedded newline ends the comment
 * early and turns the rest into new, almost certainly invalid, code; spliced
 * into a `/* ... *\/` comment, an embedded `*\/` closes it early the same way.
 * This text is read by a person, never re-parsed as code, so collapsing it to
 * one line loses nothing.
 */
export function commentSafe(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ').replace(/\*\//g, '* /');
}

/** Record an unhandled item + a matching TODO line. */
export function recordUnhandled(
  ctx: Ctx,
  code: string,
  message: string,
  snippet: string,
): void {
  ctx.unhandled.push({ code, snippet });
  ctx.todos.push({ code, message });
}

export function recordWarning(
  ctx: Ctx,
  code: string,
  message: string,
  line: number,
): void {
  ctx.warnings.push({ code, message, line });
  ctx.todos.push({ code, message });
}

/** Run `step` repeatedly until it reports no change (each call re-queries). */
export function applyUntilStable(step: () => boolean, cap = 5000): void {
  let n = 0;
  while (step()) {
    if (++n > cap) throw new Error('codemod: transform did not converge');
  }
}
