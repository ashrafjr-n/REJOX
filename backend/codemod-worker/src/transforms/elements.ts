/**
 * Element transform: rename host JSX tags to RN components per ELEMENT_MAP.
 *   - div/section/... → View · span/p/h1-6/label → Text · img → Image
 *   - button → Pressable · a → Pressable (+ Linking TODO) · input → TextInput
 *   - a container/text element carrying onPress → Pressable (it's interactive)
 *   - web-only elements (table/canvas/iframe/…) are left as-is and flagged
 *   - any other unknown host tag → View (+ warning)
 */

import { SyntaxKind, type SourceFile } from 'ts-morph';
import type { Ctx } from '../types';
import { ELEMENT_MAP, RN_COMPONENTS, WEB_ONLY_ELEMENTS } from '../maps';
import {
  applyUntilStable,
  hasAttr,
  isHostTag,
  openingOf,
  recordUnhandled,
  recordWarning,
  renameTag,
  tagNameOf,
  type JsxTagLike,
} from '../util';

/** Flag web-only elements once (they are left unchanged for Part 2). */
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
    recordUnhandled(
      ctx,
      'ANCHOR_LINK',
      `<a> → <Pressable>: wire Linking.openURL()/navigation for its href.`,
      el.getText().slice(0, 120),
    );
    mapped = 'Pressable';
  }

  if (tag === 'img') {
    recordUnhandled(
      ctx,
      'IMAGE_PROPS',
      `<img> → <Image>: convert src→source={{ uri }} and add explicit width/height.`,
      el.getText().slice(0, 120),
    );
  }
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
