/**
 * Image transform (runs after element renames, so <img> is already <Image>).
 *
 * The prop SHAPE is a rule, not a judgment call:
 *   - src="https://…"      → source={{ uri: 'https://…' }}
 *   - src={expr}           → source={{ uri: expr }}
 *   - src={importedAsset}  → source={importedAsset}   (Metro asset module)
 *   - alt                  → accessibilityLabel
 *   - width/height attrs   → style {{ width, height }}
 *   - srcSet/loading/…     → dropped (warning; no RN equivalent)
 *
 * SIZING is a design decision: RN <Image> renders 0×0 without an explicit
 * size. When width/height cannot be proven (attrs, style, or w-… / h-… class
 * tokens), a placeholder size is injected so the image is visible, plus an
 * IMAGE_SIZE warning — the shape is resolved, the number needs review.
 *
 * Each image is rewritten in ONE text replacement of its opening tag (stale
 * ts-morph refs are never reused), then the tree is re-queried.
 */

import { Node, SyntaxKind, type SourceFile } from 'ts-morph';
import type { Ctx } from '../types';
import { applyUntilStable, openingOf, recordWarning, tagNameOf, type JsxTagLike } from '../util';

const ASSET_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/;
const DROP_ATTRS = new Set(['srcSet', 'sizes', 'loading', 'decoding', 'crossOrigin', 'referrerPolicy']);
const PLACEHOLDER_SIZE = 100;

/** Is `name` a default/named import of an asset file in this source file? */
function isAssetImport(sf: SourceFile, name: string): boolean {
  for (const imp of sf.getImportDeclarations()) {
    if (!ASSET_RE.test(imp.getModuleSpecifierValue())) continue;
    if (imp.getDefaultImport()?.getText() === name) return true;
    if (imp.getNamedImports().some((n) => (n.getAliasNode() ?? n.getNameNode()).getText() === name)) {
      return true;
    }
  }
  return false;
}

/** Static class tokens in an initializer (string + template static parts). */
function staticTokens(init: Node): Set<string> {
  const tokens = new Set<string>();
  const add = (text: string) => {
    for (const t of text.split(/\s+/)) if (t) tokens.add(t);
  };
  for (const n of [init, ...init.getDescendants()]) {
    if (Node.isStringLiteral(n) || Node.isNoSubstitutionTemplateLiteral(n)) add(n.getLiteralText());
    if (Node.isTemplateExpression(n)) {
      add(n.getHead().getLiteralText());
      for (const span of n.getTemplateSpans()) add(span.getLiteral().getLiteralText());
    }
  }
  return tokens;
}

/** "{200}" → "200", "\"200\"" → "200" (numeric strings become numbers). */
function attrValueToStyleValue(text: string): string {
  let v = text.trim();
  if (v.startsWith('{') && v.endsWith('}')) v = v.slice(1, -1).trim();
  if (/^["']\d+(\.\d+)?["']$/.test(v)) v = v.slice(1, -1);
  return v;
}

interface RewritePlan {
  attrs: string[];
  styleInner: string | null; // existing style object body (inside {{ }})
  styleExprText: string | null; // non-object style expression, kept via array
  injected: string[]; // style entries to add ("width: 100")
  placeholders: string[]; // subset of injected that are placeholder guesses
  dropped: string[];
}

function planRewrite(sf: SourceFile, el: JsxTagLike): RewritePlan | null {
  const opening = openingOf(el);
  const attrs: string[] = [];
  let srcText: string | null = null;
  let styleInner: string | null = null;
  let styleExprText: string | null = null;
  let hasWidth = false;
  let hasHeight = false;
  const fromAttrs: string[] = [];
  const dropped: string[] = [];

  for (const attr of opening.getAttributes()) {
    if (!Node.isJsxAttribute(attr)) {
      attrs.push(attr.getText()); // spread {...props}
      continue;
    }
    const name = attr.getNameNode().getText();
    const init = attr.getInitializer();

    if (name === 'src') {
      if (init && Node.isStringLiteral(init)) {
        srcText = `source={{ uri: ${init.getText()} }}`;
      } else if (init && Node.isJsxExpression(init)) {
        const expr = init.getExpression();
        if (expr && Node.isIdentifier(expr) && isAssetImport(sf, expr.getText())) {
          srcText = `source={${expr.getText()}}`; // Metro asset module
        } else if (expr) {
          srcText = `source={{ uri: ${expr.getText()} }}`;
        }
      }
      continue;
    }
    if (name === 'alt') {
      attrs.push(`accessibilityLabel${init ? `=${init.getText()}` : ''}`);
      continue;
    }
    if (name === 'width' || name === 'height') {
      if (init) fromAttrs.push(`${name}: ${attrValueToStyleValue(init.getText())}`);
      if (name === 'width') hasWidth = true;
      else hasHeight = true;
      continue;
    }
    if (DROP_ATTRS.has(name)) {
      dropped.push(name);
      continue;
    }
    if (name === 'style' && init && Node.isJsxExpression(init)) {
      const expr = init.getExpression();
      if (expr && Node.isObjectLiteralExpression(expr)) {
        const text = expr.getText();
        styleInner = text.slice(1, -1).trim().replace(/,\s*$/, '');
        const props = new Set(
          expr
            .getProperties()
            .filter((p) => Node.isPropertyAssignment(p) || Node.isShorthandPropertyAssignment(p))
            .map((p) => (p as { getName(): string }).getName()),
        );
        if (props.has('width')) hasWidth = true;
        if (props.has('height')) hasHeight = true;
      } else if (expr) {
        styleExprText = expr.getText(); // dynamic style — keep, merge via array
      }
      continue;
    }
    if (name === 'className' && init) {
      const tokens = staticTokens(init);
      if ([...tokens].some((t) => /^(w-|size-)/.test(t))) hasWidth = true;
      if ([...tokens].some((t) => /^(h-|size-)/.test(t))) hasHeight = true;
    }
    attrs.push(attr.getText());
  }

  if (srcText === null) return null; // no src → nothing to do for this element
  attrs.unshift(srcText);

  const injected = [...fromAttrs];
  const placeholders: string[] = [];
  if (!hasWidth) {
    injected.push(`width: ${PLACEHOLDER_SIZE}`);
    placeholders.push('width');
  }
  if (!hasHeight) {
    injected.push(`height: ${PLACEHOLDER_SIZE}`);
    placeholders.push('height');
  }

  return { attrs, styleInner, styleExprText, injected, placeholders, dropped };
}

function styleAttrText(plan: RewritePlan): string | null {
  const { styleInner, styleExprText, injected } = plan;
  if (injected.length === 0) {
    if (styleInner !== null) return `style={{ ${styleInner} }}`;
    if (styleExprText !== null) return `style={${styleExprText}}`;
    return null;
  }
  const addition = injected.join(', ');
  if (styleExprText !== null) return `style={[${styleExprText}, { ${addition} }]}`;
  if (styleInner !== null && styleInner !== '') return `style={{ ${styleInner}, ${addition} }}`;
  return `style={{ ${addition} }}`;
}

function transformOne(sf: SourceFile, ctx: Ctx): boolean {
  const tags = [
    ...sf.getDescendantsOfKind(SyntaxKind.JsxElement),
    ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
  for (const el of tags) {
    if (tagNameOf(el) !== 'Image') continue;
    const opening = openingOf(el);
    if (!opening.getAttributes().some((a) => Node.isJsxAttribute(a) && a.getNameNode().getText() === 'src')) {
      continue; // already transformed (or a hand-written <Image>)
    }

    const line = el.getStartLineNumber();
    const plan = planRewrite(sf, el);
    if (!plan) continue;

    const style = styleAttrText(plan);
    const allAttrs = style ? [...plan.attrs, style] : plan.attrs;
    const attrText = allAttrs.length > 0 ? ` ${allAttrs.join(' ')}` : '';

    if (Node.isJsxSelfClosingElement(el)) {
      el.replaceWithText(`<Image${attrText} />`);
    } else {
      const inner = el.getJsxChildren().map((c) => c.getText()).join('');
      el.replaceWithText(`<Image${attrText}>${inner}</Image>`);
    }

    for (const name of plan.dropped) {
      recordWarning(ctx, 'WEB_ONLY_PROP', `Dropped ${name} on <Image> (no RN equivalent).`, line);
    }
    if (plan.placeholders.length > 0) {
      recordWarning(
        ctx,
        'IMAGE_SIZE',
        `<Image> at line ${line} had no provable ${plan.placeholders.join('/')}; injected ${PLACEHOLDER_SIZE} — adjust to the intended dimensions.`,
        line,
      );
    }
    ctx.rnUsed.add('Image');
    return true;
  }
  return false;
}

export function transformImages(sf: SourceFile, ctx: Ctx): void {
  applyUntilStable(() => transformOne(sf, ctx));
}
