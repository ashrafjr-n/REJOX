/** Shared, dependency-light helpers for the extractors. */

import {
  Node,
  SyntaxKind,
  type SourceFile,
  type ArrowFunction,
  type FunctionDeclaration,
  type FunctionExpression,
} from 'ts-morph';

export type FunctionLike =
  | FunctionDeclaration
  | ArrowFunction
  | FunctionExpression;

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head']);

export function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

export function isHookName(name: string): boolean {
  return /^use[A-Z0-9]/.test(name);
}

export function isHttpMethod(name: string): boolean {
  return HTTP_METHODS.has(name.toLowerCase());
}

/** True if the node's subtree contains any JSX (element / self-closing / fragment). */
export function containsJsx(node: Node): boolean {
  return (
    node.getFirstDescendantByKind(SyntaxKind.JsxElement) !== undefined ||
    node.getFirstDescendantByKind(SyntaxKind.JsxSelfClosingElement) !==
      undefined ||
    node.getFirstDescendantByKind(SyntaxKind.JsxFragment) !== undefined
  );
}

/**
 * Collect every top-level (module-scope) named function-like definition:
 * `function Foo() {}` and `const Foo = () => {}` / `const Foo = function () {}`.
 * Returns the binding name alongside the function node.
 */
export function topLevelFunctions(
  sourceFile: SourceFile,
): { name: string; fn: FunctionLike; isDefaultExport: boolean }[] {
  const out: { name: string; fn: FunctionLike; isDefaultExport: boolean }[] =
    [];

  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (!name) continue;
    out.push({ name, fn, isDefaultExport: fn.isDefaultExport() });
  }

  for (const decl of sourceFile.getVariableDeclarations()) {
    // Only module-scope declarations (parent chain: VariableStatement in file).
    const statement = decl.getVariableStatement();
    if (!statement || statement.getParent() !== sourceFile) continue;
    const init = decl.getInitializer();
    if (!init) continue;
    if (
      Node.isArrowFunction(init) ||
      Node.isFunctionExpression(init)
    ) {
      out.push({
        name: decl.getName(),
        fn: init,
        isDefaultExport: statement.hasExportKeyword() && statement.hasDefaultKeyword(),
      });
    }
  }

  return out;
}

/**
 * Resolve a same-project relative import specifier to an actual source file
 * path (relative to root, POSIX). Tries common extensions and /index.
 */
export function resolveLocalImport(
  fromFileRel: string,
  specifier: string,
  allFilesRel: Set<string>,
): string | null {
  if (!specifier.startsWith('.')) return null;
  const fromDir = fromFileRel.split('/').slice(0, -1).join('/');
  const joined = normalizePosix(`${fromDir}/${specifier}`);

  const candidates = [
    joined,
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}.js`,
    `${joined}.jsx`,
    `${joined}/index.ts`,
    `${joined}/index.tsx`,
    `${joined}/index.js`,
    `${joined}/index.jsx`,
    // style / asset imports keep their extension already in `joined`.
  ];
  for (const c of candidates) {
    if (allFilesRel.has(c)) return c;
  }
  return null;
}

/** Collapse `.` and `..` segments in a POSIX path. */
export function normalizePosix(p: string): string {
  const parts = p.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
