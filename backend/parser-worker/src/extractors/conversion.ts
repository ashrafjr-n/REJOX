/**
 * Conversion-fact extraction.
 *
 * Facts the Converter is blind without — all static, all from the AST:
 *   - textNodes    : raw text / expression children and whether they are "bare"
 *                    (not already inside a text-ish element → must be wrapped in
 *                    <Text> in RN). This is the #1 silent RN bug.
 *   - layoutHints  : per element, flex/grid info. Web flex defaults to row, RN to
 *                    column, so we must know where an explicit direction is due.
 *   - images       : per <img>, whether it has an explicit size and how its src
 *                    is provided.
 *   - inlineStyles : per element with a style={{…}} object, the CSS prop names,
 *                    so RN-incompatible props can be flagged.
 */

import { Node, SyntaxKind } from 'ts-morph';
import type { FunctionLike } from '../util';
import type { FileImports } from './imports';
import type {
  ImageInfo,
  InlineStyleInfo,
  LayoutHint,
  TextNodeInfo,
} from '../types';

// Host elements that become <Text> in RN — text directly inside them is already
// wrapped and does NOT need a new <Text>.
const TEXT_ELEMENTS = new Set([
  'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'small', 'strong',
  'em', 'b', 'i', 'mark', 'sub', 'sup', 'code', 'abbr', 'time', 'blockquote',
  'figcaption', 'dt', 'dd',
]);

function isHostTag(tag: string): boolean {
  const first = tag[0] ?? '';
  return first === first.toLowerCase() && /[a-z]/.test(first);
}

function jsxParentTag(el: Node): string {
  if (Node.isJsxElement(el)) return el.getOpeningElement().getTagNameNode().getText();
  if (Node.isJsxFragment(el)) return 'fragment';
  return '';
}

/** Static class tokens declared directly on an element's className attribute. */
function elementClassTokens(el: Node, fn: FunctionLike): Set<string> {
  const tokens = new Set<string>();
  const attrs = Node.isJsxSelfClosingElement(el)
    ? el.getAttributes()
    : Node.isJsxOpeningElement(el)
      ? el.getAttributes()
      : [];

  for (const attr of attrs) {
    if (!Node.isJsxAttribute(attr)) continue;
    if (attr.getNameNode().getText() !== 'className') continue;
    const init = attr.getInitializer();
    if (!init) continue;

    let value: Node | undefined = init;
    if (Node.isJsxExpression(init)) value = init.getExpression();
    if (!value) continue;
    harvestTokens(value, fn, tokens, 0);
  }
  return tokens;
}

function harvestTokens(node: Node, fn: FunctionLike, out: Set<string>, depth: number): void {
  const add = (text: string) => {
    for (const t of text.split(/\s+/)) if (t) out.add(t);
  };
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    add(node.getLiteralText());
  }
  for (const lit of node.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    add(lit.getLiteralText());
  }
  for (const tmpl of node.getDescendantsOfKind(SyntaxKind.TemplateExpression)) {
    add(tmpl.getHead().getLiteralText());
    for (const span of tmpl.getTemplateSpans()) add(span.getLiteral().getLiteralText());
  }
  if (depth > 1) return;
  // Resolve local variable references (e.g. Button's `base` / `variants`).
  for (const id of node.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const decl = fn
      .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
      .find((d) => d.getName() === id.getText());
    const init = decl?.getInitializer();
    if (init) harvestTokens(init, fn, out, depth + 1);
  }
}

/** Does this expression render JSX (elements), rather than plain text? */
function containsJsxChild(expr: Node): boolean {
  return (
    expr.getFirstDescendantByKind(SyntaxKind.JsxElement) !== undefined ||
    expr.getFirstDescendantByKind(SyntaxKind.JsxSelfClosingElement) !== undefined ||
    expr.getFirstDescendantByKind(SyntaxKind.JsxFragment) !== undefined
  );
}

export function extractTextNodes(fn: FunctionLike): TextNodeInfo[] {
  const out: TextNodeInfo[] = [];
  const containers = [
    ...fn.getDescendantsOfKind(SyntaxKind.JsxElement),
    ...fn.getDescendantsOfKind(SyntaxKind.JsxFragment),
  ];

  for (const el of containers) {
    const parentTag = jsxParentTag(el);
    const bare = !TEXT_ELEMENTS.has(parentTag);
    const children = Node.isJsxElement(el)
      ? el.getJsxChildren()
      : Node.isJsxFragment(el)
        ? el.getJsxChildren()
        : [];

    for (const child of children) {
      if (Node.isJsxText(child)) {
        const text = child.getText().trim();
        if (!text) continue;
        out.push({ jsxParentTag: parentTag, text, isBare: bare });
      } else if (Node.isJsxExpression(child)) {
        const expr = child.getExpression();
        if (!expr) continue; // {/* comment */}
        if (containsJsxChild(expr)) continue; // renders elements, not text
        out.push({ jsxParentTag: parentTag, text: 'dynamic', isBare: bare });
      }
    }
  }
  return out;
}

export function extractLayoutHints(fn: FunctionLike): LayoutHint[] {
  const out: LayoutHint[] = [];
  const tags = [
    ...fn.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...fn.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];

  for (const el of tags) {
    const tag = el.getTagNameNode().getText();
    if (!isHostTag(tag)) continue;
    const tokens = elementClassTokens(el, fn);

    const hasFlexClass = tokens.has('flex') || tokens.has('inline-flex');
    const isGrid = tokens.has('grid');
    let flexDirection: 'row' | 'column' | null = null;
    if (tokens.has('flex-row')) flexDirection = 'row';
    else if (tokens.has('flex-col')) flexDirection = 'column';

    if (hasFlexClass || isGrid) {
      out.push({ elementTag: tag, hasFlexClass, flexDirection, isGrid });
    }
  }
  return out;
}

export function extractImages(fn: FunctionLike, imports: FileImports): ImageInfo[] {
  const out: ImageInfo[] = [];
  const importedNames = new Set(imports.bindings.map((b) => b.local));

  const tags = [
    ...fn.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...fn.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
  for (const el of tags) {
    if (el.getTagNameNode().getText() !== 'img') continue;
    const tokens = elementClassTokens(el, fn);
    const attrs = el.getAttributes();

    const attrByName = new Map<string, Node>();
    for (const attr of attrs) {
      if (Node.isJsxAttribute(attr)) attrByName.set(attr.getNameNode().getText(), attr);
    }

    const hasWidth =
      [...tokens].some((t) => /^w-/.test(t)) || attrByName.has('width');
    const hasHeight =
      [...tokens].some((t) => /^h-/.test(t)) || attrByName.has('height');

    let srcKind: ImageInfo['srcKind'] = 'dynamic';
    let src: string | null = null;
    const srcAttr = attrByName.get('src');
    if (srcAttr && Node.isJsxAttribute(srcAttr)) {
      const init = srcAttr.getInitializer();
      if (init && Node.isStringLiteral(init)) {
        srcKind = 'literal';
        src = init.getLiteralText();
      } else if (init && Node.isJsxExpression(init)) {
        const expr = init.getExpression();
        src = expr?.getText() ?? null;
        if (expr && Node.isIdentifier(expr) && importedNames.has(expr.getText())) {
          srcKind = 'import';
        } else {
          srcKind = 'dynamic';
        }
      }
    }

    out.push({ hasExplicitSize: hasWidth && hasHeight, srcKind, src });
  }
  return out;
}

export function extractInlineStyles(fn: FunctionLike): InlineStyleInfo[] {
  const out: InlineStyleInfo[] = [];
  const tags = [
    ...fn.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...fn.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];

  for (const el of tags) {
    const tag = el.getTagNameNode().getText();
    if (!isHostTag(tag)) continue;
    for (const attr of el.getAttributes()) {
      if (!Node.isJsxAttribute(attr)) continue;
      if (attr.getNameNode().getText() !== 'style') continue;
      const init = attr.getInitializer();
      if (!init || !Node.isJsxExpression(init)) continue;
      const expr = init.getExpression();
      if (!expr || !Node.isObjectLiteralExpression(expr)) continue;

      const properties: string[] = [];
      for (const prop of expr.getProperties()) {
        if (Node.isPropertyAssignment(prop) || Node.isShorthandPropertyAssignment(prop)) {
          properties.push(prop.getName());
        }
      }
      if (properties.length) out.push({ elementTag: tag, properties });
    }
  }
  return out;
}
