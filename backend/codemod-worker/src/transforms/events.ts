/**
 * Event transform (runs while host tags are still lowercase):
 *   - onClick → onPress on host elements
 *   - onClick → onPress on PROJECT components whose props are graph-resolved
 *     as DOM-derived (options.componentEvents; e.g. Button extends
 *     ButtonHTMLAttributes) — renamed consistently with the definition side,
 *     which the props-type transform rewrites to PressableProps.
 *   - a local props interface declaring its own `onClick` prop is renamed to
 *     `onPress` (declaration + all in-file references) so both sides agree.
 *   - onChange on input/textarea → onChangeText. The handler is adapted too
 *     when it only ever reads the event's text (`e.target.value`): the event
 *     parameter becomes the string itself. Anything else it reads off the
 *     event (`e.target.name`, `.checked`, `preventDefault()`) keeps an
 *     EVENT_ADAPTER TODO — that handler's shape is a decision.
 *   - onSubmit → dropped (+ TODO)
 *   - web-only mouse/key events → dropped (+ warning)
 *
 * `<select>` keeps its onChange: the element itself is web-only residue
 * (WEB_ONLY_ELEMENT), and renaming half of it would only hide what it was.
 */

import {
  Node,
  SyntaxKind,
  type ArrowFunction,
  type FunctionDeclaration,
  type FunctionExpression,
  type SourceFile,
} from 'ts-morph';
import type { Ctx } from '../types';
import { WEB_ONLY_EVENTS } from '../maps';
import { applyUntilStable, isHostTag, recordUnhandled, recordWarning } from '../util';

const CHANGE_HOSTS = new Set(['input', 'textarea']);

type Handler = ArrowFunction | FunctionExpression | FunctionDeclaration;

/** The text a change event carries: `e.target.value` / `e.currentTarget.value`. */
function isValueRead(node: Node, param: string): boolean {
  if (!Node.isPropertyAccessExpression(node) || node.getName() !== 'value') return false;
  const target = node.getExpression();
  return (
    Node.isPropertyAccessExpression(target) &&
    ['target', 'currentTarget'].includes(target.getName()) &&
    target.getExpression().getText() === param
  );
}

/**
 * Rewrite `(e) => set(e.target.value)` into `(text) => set(text)`, in place.
 * Only when EVERY use of the event parameter is a value read — otherwise the
 * handler does something with the event a string cannot carry, and it is left
 * exactly as written. Returns whether the handler now takes the string.
 */
function adaptHandler(fn: Handler, inline: boolean): boolean {
  const params = fn.getParameters();
  if (params.length === 0) return true; // ignores its argument: already fine
  if (params.length > 1) return false;
  const param = params[0];
  // Inline, `onChangeText` types the parameter; a handler declared on its own
  // has no context to infer from, so it says `string` itself (strict mode).
  const bare = Node.isArrowFunction(fn) && !fn.getFirstChildByKind(SyntaxKind.OpenParenToken);
  const declare = (id: string) => {
    const typed = inline ? id : `${id}: string`;
    param.replaceWithText(bare && !inline ? `(${typed})` : typed);
  };

  const nameNode = param.getNameNode();
  if (Node.isObjectBindingPattern(nameNode)) {
    // `({ target: { value } }) => …` — the one destructuring that names the text.
    const text = nameNode.getText().replace(/\s+/g, '');
    const m = /^\{target:\{value(?::(\w+))?\}\}$/.exec(text);
    if (!m) return false;
    declare(m[1] ?? 'value');
    return true;
  }

  const name = param.getName();
  const body = fn.getBody();
  if (!body) return false;
  const uses = body
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .filter((id) => id.getText() === name);
  const reads = uses.map((id) => id.getParent()?.getParent());
  if (!reads.every((r) => r !== undefined && isValueRead(r, name))) return false;

  const text = uses.length === 0 ? name : name === 'value' ? name : 'text';
  if (body.getDescendantsOfKind(SyntaxKind.Identifier).some((id) => id.getText() === text && text !== name)) {
    return false; // the handler already uses that name for something else
  }
  // Replace from the last read backwards so earlier node positions stay valid.
  for (const read of [...reads].reverse()) read!.replaceWithText(text);
  declare(text);
  return true;
}

/** The function an `onChange={…}` initializer runs, when it is in this file. */
function handlerOf(sf: SourceFile, expr: Node | undefined): Handler | undefined {
  if (!expr) return undefined;
  if (Node.isArrowFunction(expr) || Node.isFunctionExpression(expr)) return expr;
  if (!Node.isIdentifier(expr)) return undefined;
  const name = expr.getText();
  // A named handler is adapted only when this attribute is its sole user: a
  // handler shared with another element (or passed elsewhere) keeps its shape.
  const refs = sf
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .filter((id) => id.getText() === name && id !== expr);
  const decl =
    sf.getDescendantsOfKind(SyntaxKind.FunctionDeclaration).find((d) => d.getName() === name) ??
    sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration).find((d) => d.getName() === name);
  if (!decl) return undefined;
  const declName = Node.isVariableDeclaration(decl) ? decl.getNameNode() : decl.getNameNode();
  if (refs.some((id) => id !== declName)) return undefined;
  if (Node.isFunctionDeclaration(decl)) return decl;
  const init = decl.getInitializer();
  return init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) ? init : undefined;
}

function ownerTag(attr: Node): string | null {
  const owner =
    attr.getFirstAncestorByKind(SyntaxKind.JsxOpeningElement) ??
    attr.getFirstAncestorByKind(SyntaxKind.JsxSelfClosingElement);
  return owner ? owner.getTagNameNode().getText() : null;
}

function transformOne(sf: SourceFile, ctx: Ctx): boolean {
  const componentEvents = ctx.options.componentEvents ?? {};

  for (const attr of sf.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    const tag = ownerTag(attr);
    if (!tag) continue;
    const name = attr.getNameNode().getText();
    const line = attr.getStartLineNumber();

    // Project components: rename only what the Knowledge Graph proved is a
    // DOM-derived prop — a component's own (value: T) => void API is never touched.
    if (!isHostTag(tag)) {
      const renamed = componentEvents[tag]?.[name];
      if (renamed && renamed !== name) {
        attr.getNameNode().replaceWithText(renamed);
        return true;
      }
      continue;
    }

    if (name === 'onClick') {
      attr.getNameNode().replaceWithText('onPress');
      return true;
    }
    if (name === 'onChange' && CHANGE_HOSTS.has(tag)) {
      const init = attr.getInitializer();
      const expr = init && Node.isJsxExpression(init) ? init.getExpression() : undefined;
      const handler = handlerOf(sf, expr);
      const snippet = attr.getText();
      // Rename first: it touches only the name node, so the handler found
      // above is still a live node when it is adapted below.
      attr.getNameNode().replaceWithText('onChangeText');
      const adapted = handler !== undefined && adaptHandler(handler, handler === expr);
      if (!adapted) {
        recordUnhandled(
          ctx,
          'EVENT_ADAPTER',
          `onChange→onChangeText on <${tag}> (line ${line}): the handler reads more off the event than its value — it now receives a string; reshape it by hand.`,
          snippet,
        );
      }
      return true;
    }
    if (name === 'onSubmit') {
      recordUnhandled(
        ctx,
        'FORM_SUBMIT',
        `onSubmit on <${tag}> (line ${line}) has no RN equivalent; handle submission in state.`,
        attr.getText(),
      );
      attr.remove();
      return true;
    }
    if (WEB_ONLY_EVENTS.has(name)) {
      recordWarning(ctx, 'WEB_ONLY_EVENT', `Dropped ${name} on <${tag}> (no touch equivalent).`, line);
      attr.remove();
      return true;
    }
  }
  return false;
}

/**
 * Definition side of the custom-component rename: a local props interface that
 * declares its own `onClick` becomes `onPress` (declaration + all in-file
 * references), matching the caller-side rename driven by componentEvents.
 */
function renameLocalOnClickProps(sf: SourceFile, ctx: Ctx): void {
  for (const iface of sf.getInterfaces()) {
    const prop = iface.getProperty('onClick');
    if (!prop) continue;
    const line = prop.getStartLineNumber();
    prop.rename('onPress');
    recordWarning(
      ctx,
      'EVENT_PROP_RENAMED',
      `Own prop onClick → onPress on ${iface.getName()} (line ${line}); callers are renamed via the graph.`,
      line,
    );
  }
}

export function transformEvents(sf: SourceFile, ctx: Ctx): void {
  renameLocalOnClickProps(sf, ctx);
  applyUntilStable(() => transformOne(sf, ctx));
}
