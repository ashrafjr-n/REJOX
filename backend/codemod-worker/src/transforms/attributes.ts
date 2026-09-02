/**
 * Attribute transform (runs while host tags are still lowercase):
 *   - DOM-only attributes are dropped before their element is renamed, so the
 *     RN component is never handed a prop it does not have.
 *
 * The rename itself is what makes these an error: `<button type="button">` is
 * valid DOM and `<Pressable type="button">` is a TS2322, because `type` is a
 * `<button>` attribute and `PressableProps` has no such member. Nothing about
 * the app's behaviour lives in them, so they are dropped with a warning rather
 * than recorded as residue — there is no judgment left for anyone to make.
 */

import { SyntaxKind, type SourceFile } from 'ts-morph';
import type { Ctx } from '../types';
import { WEB_ONLY_ATTRIBUTES } from '../maps';
import { applyUntilStable, isHostTag, recordWarning } from '../util';

function transformOne(sf: SourceFile, ctx: Ctx): boolean {
  for (const attr of sf.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    const owner =
      attr.getFirstAncestorByKind(SyntaxKind.JsxOpeningElement) ??
      attr.getFirstAncestorByKind(SyntaxKind.JsxSelfClosingElement);
    if (!owner) continue;

    const tag = owner.getTagNameNode().getText();
    // Project components keep their own API — only host elements get renamed,
    // so only host elements can inherit an attribute the target cannot take.
    if (!isHostTag(tag)) continue;

    const name = attr.getNameNode().getText();
    if (!WEB_ONLY_ATTRIBUTES[tag]?.has(name)) continue;

    recordWarning(
      ctx,
      'WEB_ONLY_ATTRIBUTE',
      `Dropped ${name} on <${tag}> (no React Native equivalent).`,
      attr.getStartLineNumber(),
    );
    attr.remove();
    return true;
  }
  return false;
}

export function transformAttributes(sf: SourceFile, ctx: Ctx): void {
  applyUntilStable(() => transformOne(sf, ctx));
}
