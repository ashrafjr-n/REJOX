/**
 * Styling extraction.
 *
 * For a given component function, determines the styling approach(es) used —
 * Tailwind utility classes, CSS Modules, inline styles — and collects the
 * unique Tailwind class tokens and CSS-Module import paths.
 *
 * Class tokens are read from STATIC string content only: string literals and
 * the static quasis of template literals in `className`, plus the string
 * literals of any local variable/object that a `className` expression
 * references (e.g. Button's `base` string and `variants` map). Purely dynamic
 * values are never guessed.
 */

import { Node, SyntaxKind } from 'ts-morph';
import type { FunctionLike } from '../util';
import type { FileImports } from './imports';
import type { StylingApproach } from '../types';

export interface StylingInfo {
  stylingApproach: StylingApproach[];
  tailwindClasses: string[];
  cssModuleImports: string[];
}

const CSS_MODULE_RE = /\.module\.(css|scss|sass|less)$/;

function tokenize(value: string): string[] {
  return value.split(/\s+/).filter((t) => t.length > 0);
}

/** Find a local (function- or module-scope) variable declaration by name. */
function findVarInitializer(fn: FunctionLike, name: string): Node | undefined {
  for (const decl of fn.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (decl.getName() === name) return decl.getInitializer();
  }
  const sf = fn.getSourceFile();
  for (const decl of sf.getVariableDeclarations()) {
    if (decl.getName() === name) return decl.getInitializer();
  }
  return undefined;
}

/** Harvest raw string-literal class tokens directly present in a node subtree. */
function harvestStaticTokens(node: Node, out: Set<string>): boolean {
  let found = false;
  const addAll = (text: string) => {
    for (const t of tokenize(text)) {
      out.add(t);
      found = true;
    }
  };

  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    addAll(node.getLiteralText());
  }
  for (const lit of node.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    addAll(lit.getLiteralText());
  }
  for (const tmpl of node.getDescendantsOfKind(SyntaxKind.TemplateExpression)) {
    addAll(tmpl.getHead().getLiteralText());
    for (const span of tmpl.getTemplateSpans()) {
      addAll(span.getLiteral().getLiteralText());
    }
  }
  return found;
}

/** Collect class tokens from a className expression, resolving local refs. */
function collectClasses(
  node: Node,
  fn: FunctionLike,
  out: Set<string>,
  depth = 0,
): boolean {
  let found = harvestStaticTokens(node, out);
  if (depth > 2) return found;

  // Resolve identifiers referenced in the expression to their local
  // string/object initializers (e.g. `base`, `variants`).
  const identifiers = [
    ...(Node.isIdentifier(node) ? [node] : []),
    ...node.getDescendantsOfKind(SyntaxKind.Identifier),
  ];
  const seen = new Set<string>();
  for (const id of identifiers) {
    const name = id.getText();
    if (seen.has(name)) continue;
    seen.add(name);
    const init = findVarInitializer(fn, name);
    if (init) {
      if (collectClasses(init, fn, out, depth + 1)) found = true;
    }
  }
  return found;
}

export function extractStyling(
  fn: FunctionLike,
  imports: FileImports,
): StylingInfo {
  const approaches = new Set<StylingApproach>();
  const tailwind = new Set<string>();

  const cssModuleImports = imports.specifiers.filter((s) =>
    CSS_MODULE_RE.test(s),
  );
  if (cssModuleImports.length > 0) approaches.add('css-module');

  for (const attr of fn.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    const name = attr.getNameNode().getText();
    const initializer = attr.getInitializer();
    if (!initializer) continue;

    if (name === 'className') {
      let value: Node | undefined = initializer;
      if (Node.isJsxExpression(initializer)) value = initializer.getExpression();
      if (value) {
        // Only count Tailwind when real static class tokens were found; a bare
        // `className={styles.x}` (member access, no strings) is CSS-Module use.
        if (collectClasses(value, fn, tailwind)) approaches.add('tailwind');
      }
    }

    if (name === 'style' && Node.isJsxExpression(initializer)) {
      const expr = initializer.getExpression();
      if (expr && Node.isObjectLiteralExpression(expr)) approaches.add('inline');
    }
  }

  if (approaches.size === 0) approaches.add('none');

  return {
    stylingApproach: [...approaches],
    tailwindClasses: [...tailwind].sort(),
    cssModuleImports,
  };
}
