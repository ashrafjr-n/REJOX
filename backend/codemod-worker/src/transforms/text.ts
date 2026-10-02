/**
 * Text-wrapping transform (runs after element renames, so parent tags are RN).
 *
 * RN requires every string to live inside <Text> — a single space included:
 * `<View><Text>a</Text> <Text>b</Text></View>` renders the " " between them as
 * a string child of the View, and RN throws on it at runtime. tsc and Metro
 * both accept it, so this pass is the only thing standing between that JSX
 * and a crash. Under a parent that is NOT already a <Text>:
 *
 *   1. an inline run — text mixed with <Text> elements, as in
 *      `<strong>bold</strong> text` — is wrapped as ONE <Text>, the inline
 *      flow it was on the web;
 *   2. a space-only JsxText between elements is removed (a JsxText holding a
 *      line break is dropped by JSX itself, and never reaches RN);
 *   3. any other JsxText or text-only JsxExpression is wrapped on its own,
 *      with the spaces around it moved INSIDE the <Text>.
 *
 * Text inside a <Text> (originally span, p, headings, label) is left alone.
 */

import { Node, SyntaxKind, type JsxText, type SourceFile } from 'ts-morph';
import type { Ctx } from '../types';
import { TEXT_RN } from '../maps';
import { applyUntilStable, containsJsx, tagNameOf } from '../util';

function parentTagOf(child: Node): string | null {
  const parent = child.getParent();
  if (!parent) return null;
  if (Node.isJsxElement(parent)) return parent.getOpeningElement().getTagNameNode().getText();
  if (Node.isJsxFragment(parent)) return 'fragment';
  return null;
}

/**
 * A JsxText's real text. `getText()` starts after leading "trivia", and to the
 * compiler a JsxText's whitespace IS trivia — a lone " " reads as "". The
 * space is exactly what this pass is about, so it reads the full text.
 */
function rawText(node: JsxText): string {
  return node.getFullText();
}

/** Where a child's source starts, leading spaces of a JsxText included. */
function startOf(node: Node): number {
  return Node.isJsxText(node) ? node.getPos() : node.getStart();
}

/** A JsxText JSX drops entirely: whitespace that spans a line break. */
function isDroppedWhitespace(node: Node): boolean {
  return Node.isJsxText(node) && rawText(node).trim() === '' && /[\r\n]/.test(rawText(node));
}

/** A JsxText RN would render as a bare string: text, or a same-line space. */
function isRenderedText(node: Node): node is JsxText {
  return Node.isJsxText(node) && !isDroppedWhitespace(node) && rawText(node) !== '';
}

function isTextExpression(node: Node): boolean {
  if (!Node.isJsxExpression(node)) return false;
  const inner = node.getExpression();
  return inner !== undefined && !containsJsx(inner);
}

function isTextElement(node: Node): boolean {
  return (Node.isJsxElement(node) || Node.isJsxSelfClosingElement(node)) && tagNameOf(node) === TEXT_RN;
}

/** Step 1: wrap one inline run of text + <Text> elements under a non-Text parent. */
function wrapInlineRun(sf: SourceFile, ctx: Ctx): boolean {
  const parents = [
    ...sf.getDescendantsOfKind(SyntaxKind.JsxElement),
    ...sf.getDescendantsOfKind(SyntaxKind.JsxFragment),
  ];
  for (const parent of parents) {
    const tag = Node.isJsxElement(parent) ? tagNameOf(parent) : 'fragment';
    if (tag === TEXT_RN) continue;
    const children = parent.getJsxChildren();

    // A run never crosses a line break: `<h3>{title}</h3>` on one line and
    // `{children}` on the next are separate blocks, not one sentence.
    let run: Node[] = [];
    const flush = (): boolean => {
      const hasText = run.some(
        (n) => (isRenderedText(n) && rawText(n).trim() !== '') || isTextExpression(n),
      );
      // One piece of text alone is step 3's; text next to a <Text> or to more
      // text (`{a} {b}`) is one line on the web, so it stays one <Text>.
      if (!hasText || run.length < 2) {
        run = [];
        return false;
      }
      const start = startOf(run[0]);
      const end = run[run.length - 1].getEnd();
      const inner = sf.getFullText().slice(start, end);
      sf.replaceText([start, end], `<Text>${inner}</Text>`);
      ctx.rnUsed.add('Text');
      return true;
    };
    for (const child of children) {
      if (isTextElement(child) || isRenderedText(child) || isTextExpression(child)) {
        run.push(child);
      } else if (flush()) {
        return true;
      }
    }
    if (flush()) return true;
  }
  return false;
}

function transformOne(sf: SourceFile, ctx: Ctx): boolean {
  if (wrapInlineRun(sf, ctx)) return true;

  // Bare JsxText children.
  for (const text of sf.getDescendantsOfKind(SyntaxKind.JsxText)) {
    const raw = rawText(text);
    const trimmed = raw.trim();
    const parentTag = parentTagOf(text);
    if (parentTag === null || parentTag === TEXT_RN) continue;

    if (!trimmed) {
      // Step 2: a same-line space between elements is a string child of a
      // View; drop it. Whitespace across a line break is JSX's to drop.
      if (raw === '' || /[\r\n]/.test(raw)) continue;
      sf.replaceText([text.getPos(), text.getEnd()], '');
      return true;
    }

    // Step 3: spaces on the same line as the text are part of it; only
    // whitespace that crosses a line break stays outside (JSX drops it).
    const start = raw.indexOf(trimmed);
    const lead = raw.slice(0, start);
    const trail = raw.slice(start + trimmed.length);
    const [leadOut, leadIn] = /[\r\n]/.test(lead) ? [lead, ''] : ['', lead];
    const [trailIn, trailOut] = /[\r\n]/.test(trail) ? ['', trail] : [trail, ''];
    sf.replaceText(
      [text.getPos(), text.getEnd()],
      `${leadOut}<Text>${leadIn}${trimmed}${trailIn}</Text>${trailOut}`,
    );
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
