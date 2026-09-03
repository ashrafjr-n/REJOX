/** Shared helpers for the transforms. */

import {
  Node,
  SyntaxKind,
  type JsxAttribute,
  type JsxElement,
  type JsxSelfClosingElement,
  type JsxOpeningElement,
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
