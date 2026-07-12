/**
 * react-router link transform.
 *
 * <Link>/<NavLink> → <Pressable> (structure preserved, className kept verbatim),
 * dropping the router-specific `to`/`end` props and leaving an inline
 * REJOX-TODO plus an `unhandled` entry — wiring navigation.navigate() is
 * navigation-dependent and belongs to Part 2 (LLM).
 */

import { Node, SyntaxKind, type SourceFile } from 'ts-morph';
import type { Ctx } from '../types';
import { applyUntilStable, recordUnhandled, tagNameOf, type JsxTagLike } from '../util';

const ROUTER_LINK_TAGS = new Set(['Link', 'NavLink']);
const DROP_PROPS = new Set(['to', 'end', 'replace', 'reloadDocument']);

function attrsText(el: JsxTagLike): { kept: string; toValue: string; hasFnClassName: boolean } {
  const opening = Node.isJsxElement(el) ? el.getOpeningElement() : el;
  const kept: string[] = [];
  let toValue = '';
  let hasFnClassName = false;

  for (const attr of opening.getAttributes()) {
    if (!Node.isJsxAttribute(attr)) {
      kept.push(attr.getText()); // spread {...props}
      continue;
    }
    const name = attr.getNameNode().getText();
    if (name === 'to') {
      const init = attr.getInitializer();
      toValue = init ? init.getText() : '';
      continue;
    }
    if (DROP_PROPS.has(name)) continue;
    if (name === 'className') {
      const init = attr.getInitializer();
      if (init && Node.isJsxExpression(init)) {
        const expr = init.getExpression();
        if (expr && (Node.isArrowFunction(expr) || Node.isFunctionExpression(expr))) {
          hasFnClassName = true;
        }
      }
    }
    kept.push(attr.getText());
  }
  return { kept: kept.join(' '), toValue, hasFnClassName };
}

function childrenText(el: JsxTagLike): string {
  if (Node.isJsxSelfClosingElement(el)) return '';
  return el.getJsxChildren().map((c) => c.getText()).join('');
}

function transformOne(sf: SourceFile, ctx: Ctx): boolean {
  const tags = [
    ...sf.getDescendantsOfKind(SyntaxKind.JsxElement),
    ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
  for (const el of tags) {
    const tag = tagNameOf(el);
    if (!ROUTER_LINK_TAGS.has(tag)) continue;

    const line = el.getStartLineNumber();
    const { kept, toValue, hasFnClassName } = attrsText(el);
    const inner = childrenText(el);

    const todo = `{/* REJOX-TODO(NAV_LINK): wire navigation.navigate(${toValue || '…'}) */}`;
    const attrs = kept ? ` ${kept}` : '';
    const replacement =
      `<Pressable${attrs} onPress={() => {}}>` +
      `${todo}${inner}</Pressable>`;

    el.replaceWithText(replacement);
    ctx.rnUsed.add('Pressable');
    recordUnhandled(
      ctx,
      'NAV_LINK',
      `<${tag}> at line ${line} → <Pressable>: wire navigation.navigate(${toValue || '…'}).`,
      replacement,
    );
    if (hasFnClassName) {
      recordUnhandled(
        ctx,
        'NAV_ACTIVE',
        `<${tag}> at line ${line} used an active-state className function; re-express with navigation state.`,
        replacement,
      );
    }
    return true;
  }
  return false;
}

export function transformLinks(sf: SourceFile, ctx: Ctx): void {
  applyUntilStable(() => transformOne(sf, ctx));
}
