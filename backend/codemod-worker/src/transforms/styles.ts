/**
 * Tailwind → NativeWind transform.
 *
 * The mechanical majority of utility classes map 1:1 under NativeWind and pass
 * through untouched. The declarative NATIVEWIND support tables below make the
 * split explicit:
 *
 *   - supported  : everything not matched below — passed through verbatim.
 *   - renamed    : mechanical rewrites (space-x-… → gap-x-…, child-selector
 *                  spacing has no RN equivalent but flex gap does).
 *   - unsupported: hover:, group-…, grid-…, gradients, backdrop-…,
 *                  transitions/animations, sticky/fixed, divide-… — genuinely
 *                  no NativeWind mapping. These (and ONLY these) become
 *                  residue (TW_UNSUPPORTED): re-expressing them is design.
 *
 * Also makes web's implicit flex direction explicit: a `flex` container with
 * no flex-row/flex-col gets ` flex-row` appended — web defaults to row, RN to
 * column, so this preserves layout intent by rule.
 *
 * Rewrites touch plain string classNames (and template heads for the flex
 * append); classes referenced via local variables are classified for residue
 * but never rewritten in place.
 */

import { Node, SyntaxKind, type SourceFile } from 'ts-morph';
import type { Ctx } from '../types';
import { recordUnhandled, recordWarning } from '../util';

// Variant prefixes NativeWind handles (with config) — strip and re-classify.
const SUPPORTED_VARIANT = /^(sm|md|lg|xl|2xl|dark|active|focus|disabled|ios|android|web):/;

/** Utility patterns with NO NativeWind/RN mapping — the honest unsupported set. */
const UNSUPPORTED: RegExp[] = [
  /^hover:/,
  /^group$/, /^group[-/]/, /(^|:)group-hover[:/]/,
  /^grid$/, /^inline-grid$/, /^grid-(cols|rows|flow)-/,
  /^(col|row)-(auto$|span-|start-|end-)/, /^auto-(cols|rows)-/,
  /^bg-gradient-/, /^from-/, /^via-/, /^to-/,
  /^backdrop-/,
  /^transition/, /^duration-/, /^ease-/, /^delay-/, /^animate-/,
  /^sticky$/, /^fixed$/,
  /^divide-/,
];

/** Mechanical renames: web-only spacing → RN flex gap. */
const RENAMES: [RegExp, string][] = [
  [/^space-x-(.+)$/, 'gap-x-$1'],
  [/^space-y-(.+)$/, 'gap-y-$1'],
];

/** Classify one token; variant prefixes are stripped until the base remains. */
export function isUnsupported(token: string): boolean {
  let base = token;
  for (;;) {
    if (UNSUPPORTED.some((re) => re.test(base))) return true;
    const stripped = base.replace(SUPPORTED_VARIANT, '');
    if (stripped === base) return false;
    base = stripped;
  }
}

function renameToken(token: string): string | null {
  for (const [re, replacement] of RENAMES) {
    if (re.test(token)) return token.replace(re, replacement);
  }
  return null;
}

// --- token harvesting (mirrors the Intelligence Engine's styling extractor) --

function harvest(node: Node, out: Set<string>): void {
  const add = (text: string) => {
    for (const t of text.split(/\s+/)) if (t) out.add(t);
  };
  for (const n of [node, ...node.getDescendants()]) {
    if (Node.isStringLiteral(n) || Node.isNoSubstitutionTemplateLiteral(n)) add(n.getLiteralText());
    if (Node.isTemplateExpression(n)) {
      add(n.getHead().getLiteralText());
      for (const span of n.getTemplateSpans()) add(span.getLiteral().getLiteralText());
    }
  }
}

/** All static class tokens reachable from a className value (resolving local vars). */
function collectTokens(value: Node, sf: SourceFile, out: Set<string>, depth = 0): void {
  harvest(value, out);
  if (depth > 2) return;
  const seen = new Set<string>();
  const ids = [
    ...(Node.isIdentifier(value) ? [value] : []),
    ...value.getDescendantsOfKind(SyntaxKind.Identifier),
  ];
  for (const id of ids) {
    const name = id.getText();
    if (seen.has(name)) continue;
    seen.add(name);
    for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      if (decl.getName() !== name) continue;
      const init = decl.getInitializer();
      if (init) collectTokens(init, sf, out, depth + 1);
      break;
    }
  }
}

// --- rewrites -----------------------------------------------------------------

/** Apply renames + the explicit flex-row rule to a literal class string. */
function rewriteClassString(text: string): { text: string; flexMadeExplicit: boolean } {
  const tokens = text.split(/(\s+)/); // keep separators
  let changed = false;
  for (let i = 0; i < tokens.length; i++) {
    const renamed = renameToken(tokens[i]);
    if (renamed !== null) {
      tokens[i] = renamed;
      changed = true;
    }
  }
  let result = tokens.join('');

  const classList = result.split(/\s+/).filter(Boolean);
  const hasFlex = classList.includes('flex') || classList.includes('inline-flex');
  const hasDirection = classList.some((t) => /^flex-(row|col)/.test(t));
  const isGrid = classList.includes('grid') || classList.includes('inline-grid');
  let flexMadeExplicit = false;
  if (hasFlex && !hasDirection && !isGrid) {
    result = `${result} flex-row`;
    flexMadeExplicit = true;
  }

  return { text: changed || flexMadeExplicit ? result : text, flexMadeExplicit };
}

function transformClassNames(sf: SourceFile, ctx: Ctx): void {
  const residue = new Set<string>();

  // One pass to classify + collect rewrite positions; rewrites are applied one
  // at a time with a re-query (text replacement invalidates node refs).
  for (;;) {
    let mutated = false;
    for (const attr of sf.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
      if (attr.getNameNode().getText() !== 'className') continue;
      const init = attr.getInitializer();
      if (!init) continue;

      let value: Node = init;
      if (Node.isJsxExpression(init)) {
        const expr = init.getExpression();
        if (!expr) continue;
        value = expr;
      }

      // Classify everything reachable (incl. local vars) for residue.
      const tokens = new Set<string>();
      collectTokens(value, sf, tokens);
      for (const t of tokens) if (isUnsupported(t)) residue.add(t);

      // Rewrite only the directly-editable literal forms.
      if (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value)) {
        const original = value.getLiteralText();
        const { text, flexMadeExplicit } = rewriteClassString(original);
        if (text !== original) {
          const line = value.getStartLineNumber();
          value.replaceWithText(`"${text}"`);
          if (flexMadeExplicit) {
            recordWarning(
              ctx,
              'FLEX_ROW_MADE_EXPLICIT',
              `flex container at line ${line}: web defaults to row, RN to column — appended flex-row.`,
              line,
            );
          }
          mutated = true;
          break; // re-query
        }
      }
    }
    if (!mutated) break;
  }

  if (residue.size > 0) {
    const classes = [...residue].sort();
    recordUnhandled(
      ctx,
      'TW_UNSUPPORTED',
      `${classes.length} Tailwind class(es) have no NativeWind mapping: ${classes.join(', ')} — re-express (pressed state / flex reflow / expo-linear-gradient / moti).`,
      classes.join(' '),
    );
  }
}

export function transformStyles(sf: SourceFile, ctx: Ctx): void {
  // Only meaningful when the target styling engine keeps className.
  const engine = ctx.options.stylingEngine ?? 'nativewind';
  if (engine !== 'nativewind') return;
  transformClassNames(sf, ctx);
}
