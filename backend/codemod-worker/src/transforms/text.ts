/**
 * Text-wrapping transform (runs after element renames, so parent tags are RN).
 *
 * RN requires every bare string to live inside <Text>. Any JsxText or text-only
 * JsxExpression whose parent is NOT already a <Text> is wrapped. Text inside a
 * <Text> (originally span, p, headings, label) is left alone — already wrapped.
 */

import { Node, SyntaxKind, type SourceFile } from 'ts-morph';
import type { Ctx } from '../types';
import { TEXT_RN } from '../maps';
import { applyUntilStable, containsJsx } from '../util';

function parentTagOf(child: Node): string | null {
  const parent = child.getParent();
  if (!parent) return null;
  if (Node.isJsxElement(parent)) return parent.getOpeningElement().getTagNameNode().getText();
  if (Node.isJsxFragment(parent)) return 'fragment';
  return null;
}

function transformOne(sf: SourceFile, ctx: Ctx): boolean {
  // Bare JsxText children.
  for (const text of sf.getDescendantsOfKind(SyntaxKind.JsxText)) {
    const raw = text.getText();
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const parentTag = parentTagOf(text);
    if (parentTag === null || parentTag === TEXT_RN) continue;

    const start = raw.indexOf(trimmed);
    const lead = raw.slice(0, start);
    const trail = raw.slice(start + trimmed.length);
    text.replaceWithText(`${lead}<Text>${trimmed}</Text>${trail}`);
    ctx.rnUsed.add('Text');
    return true;
  }

  // Text-only JsxExpression children (e.g. {product.title}); skip ones that
  // render elements ({items.map(...)}) or are comments.
  for (const expr of sf.getDescendantsOfKind(SyntaxKind.JsxExpression)) {
    const parentTag = parentTagOf(expr);
    if (parentTag === null || parentTag === TEXT_RN) continue;
    const inner = expr.getExpression();
    if (!inner) continue; // {/* comment */}
    if (containsJsx(inner)) continue; // renders elements, not text
    expr.replaceWithText(`<Text>${expr.getText()}</Text>`);
    ctx.rnUsed.add('Text');
    return true;
  }

  return false;
}

export function transformText(sf: SourceFile, ctx: Ctx): void {
  applyUntilStable(() => transformOne(sf, ctx));
}
