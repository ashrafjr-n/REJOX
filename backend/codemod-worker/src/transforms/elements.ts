/**
 * Element transform: rename host JSX tags to RN components per ELEMENT_MAP.
 *   - div/section/... → View · span/p/h1-6/label → Text · img → Image
 *   - button → Pressable · a → Pressable (+ Linking TODO) · input → TextInput
 *   - a container/text element carrying onPress → Pressable (it's interactive)
 *   - web-only elements (table/canvas/iframe/…) are left as-is and flagged
 *   - any other unknown host tag → View (+ warning)
 */

import { Node, SyntaxKind, type SourceFile } from 'ts-morph';
import type { Ctx } from '../types';
import { ELEMENT_MAP, RN_COMPONENTS, WEB_ONLY_ELEMENTS } from '../maps';
import {
  applyUntilStable,
  commentSafe,
  getAttr,
  hasAttr,
  requestNamedImport,
  isHostTag,
  openingOf,
  recordUnhandled,
  recordWarning,
  renameTag,
  tagNameOf,
  type JsxTagLike,
} from '../util';

/** Flag web-only elements once (left unchanged; redesign needs judgment). */
function flagWebOnly(sf: SourceFile, ctx: Ctx): void {
  const seen = new Set<string>();
  const tags = [
    ...sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
  for (const el of tags) {
    const tag = el.getTagNameNode().getText();
    if (WEB_ONLY_ELEMENTS.has(tag) && !seen.has(tag)) {
      seen.add(tag);
      recordUnhandled(
        ctx,
        'WEB_ONLY_ELEMENT',
        `<${tag}> has no React Native equivalent; needs a manual redesign.`,
        `<${tag}>`,
      );
    }
  }
}

function decideMapping(el: JsxTagLike, tag: string, ctx: Ctx): string | null {
  if (WEB_ONLY_ELEMENTS.has(tag)) return null; // handled by flagWebOnly

  let mapped = ELEMENT_MAP[tag];
  if (!mapped) {
    recordWarning(
      ctx,
      'UNMAPPED_ELEMENT',
      `<${tag}> is not in the element map; defaulted to <View>.`,
      el.getStartLineNumber(),
    );
    mapped = 'View';
  }

  // An interactive container/text element must become Pressable.
  const opening = openingOf(el);
  if ((mapped === 'View' || mapped === 'Text') && hasAttr(opening, 'onPress')) {
    mapped = 'Pressable';
  }

  if (tag === 'a') {
    // The navigation pass already turned every href a rule could open into an
    // onPress. What is left is an href whose target is not certain — a runtime
    // value, an in-page `#anchor`, a path no route matches. `href` is not a
    // Pressable prop (keeping it is a tsc error), so it goes, and the TODO
    // carries its value.
    const href = getAttr(opening, 'href');
    if (href) {
      const init = href.getInitializer();
      const value = init && Node.isJsxExpression(init) ? init.getExpression() : init;
      const valueText = value ? value.getText() : '';
      const target = commentSafe(valueText);
      const dynamic = value !== undefined && !Node.isStringLiteral(value)
        && !Node.isNoSubstitutionTemplateLiteral(value);
      href.remove(); // `value` lived inside it: only its text is used from here
      if (dynamic && !hasAttr(opening, 'onPress')) {
        // A runtime URL: open it, and ask a human to confirm it is external.
        opening.addAttribute({ name: 'onPress', initializer: `{() => Linking.openURL(${valueText})}` });
        requestNamedImport(ctx, 'react-native', 'Linking');
        recordUnhandled(
          ctx,
          'ANCHOR_LINK',
          `<a href={${target}}> → <Pressable onPress={() => Linking.openURL(…)}>: confirm it is an external URL; an in-app path needs navigation.navigate(…) instead.`,
          target,
        );
      } else if (hasAttr(opening, 'onPress')) {
        recordUnhandled(
          ctx,
          'ANCHOR_LINK',
          `<a href=${target}> → <Pressable>: its press handler is kept, but on the web the link then also went to ${target} — add that navigation to the handler if it matters.`,
          target,
        );
      } else {
        recordUnhandled(
          ctx,
          'ANCHOR_LINK',
          `<a href=${target}> → <Pressable>: no route or URL a rule can open (an in-page anchor, or a path with no route) — wire its onPress by hand.`,
          target,
        );
      }
    }
    mapped = 'Pressable';
  }

  // img → Image needs no residue entry: the images transform resolves
  // src→source/alt/size deterministically right after this pass.
  return mapped;
}

function transformOne(sf: SourceFile, ctx: Ctx): boolean {
  const tags = [
    ...sf.getDescendantsOfKind(SyntaxKind.JsxElement),
    ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
  for (const el of tags) {
    const tag = tagNameOf(el);
    if (!isHostTag(tag)) continue;
    const mapped = decideMapping(el, tag, ctx);
    if (!mapped || mapped === tag) continue;
    renameTag(el, mapped);
    if (RN_COMPONENTS.has(mapped)) ctx.rnUsed.add(mapped);
    return true;
  }
  return false;
}

export function transformElements(sf: SourceFile, ctx: Ctx): void {
  flagWebOnly(sf, ctx);
  applyUntilStable(() => transformOne(sf, ctx));
}
