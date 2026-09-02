/**
 * Route extraction (react-router).
 *
 * Handles the JSX `<Route>` form (`<Route path="products/:id" element={<X/>} />`
 * and `<Route index element={<X/>} />`). Only routes that declare a `path` or
 * `index` are emitted — layout/pathless wrapper routes are skipped.
 *
 * The object-config form (`createBrowserRouter([...])`) is not yet handled; see
 * warnings emitted by the caller.
 */

import { Node, SyntaxKind, type SourceFile } from 'ts-morph';
import type { Route } from '../types';
import type { FileImports } from './imports';

function stringAttr(attr: Node | undefined): string | null {
  if (!attr || !Node.isJsxAttribute(attr)) return null;
  const init = attr.getInitializer();
  if (init && Node.isStringLiteral(init)) return init.getLiteralText();
  return null;
}

/** The `<X … />` inside `element={…}`, as an opening/self-closing tag. */
function elementTag(attr: Node | undefined) {
  if (!attr || !Node.isJsxAttribute(attr)) return null;
  const init = attr.getInitializer();
  if (!init || !Node.isJsxExpression(init)) return null;
  const expr = init.getExpression();
  if (!expr) return null;
  if (Node.isJsxSelfClosingElement(expr)) return expr;
  if (Node.isJsxElement(expr)) return expr.getOpeningElement();
  return null;
}

function componentNameFromElement(attr: Node | undefined): string | null {
  return elementTag(attr)?.getTagNameNode().getText() ?? null;
}

/**
 * Named props on the route's element. Spreads (`{...rest}`) have no name to
 * report, so they are counted under `...` rather than passed over in silence.
 */
function elementPropsFrom(attr: Node | undefined): string[] {
  const tag = elementTag(attr);
  if (!tag) return [];
  return tag
    .getAttributes()
    .map((a) => (Node.isJsxAttribute(a) ? a.getNameNode().getText() : '...'));
}

function paramsFromPath(path: string): string[] {
  return path
    .split('/')
    .filter((seg) => seg.startsWith(':'))
    .map((seg) => seg.slice(1).replace(/\?$/, ''));
}

export function extractRoutes(
  sourceFile: SourceFile,
  imports: FileImports,
): Route[] {
  const routes: Route[] = [];

  const tagNodes = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];

  for (const tag of tagNodes) {
    if (tag.getTagNameNode().getText() !== 'Route') continue;

    const attrMap = new Map<string, Node>();
    for (const attr of tag.getAttributes()) {
      if (Node.isJsxAttribute(attr)) {
        attrMap.set(attr.getNameNode().getText(), attr);
      }
    }

    const hasIndex = attrMap.has('index');
    const rawPath = stringAttr(attrMap.get('path'));

    // Skip pathless layout/wrapper routes.
    if (!hasIndex && rawPath === null) continue;

    const path = hasIndex ? '/' : rawPath;
    const componentName = componentNameFromElement(attrMap.get('element'));
    const file =
      componentName && imports.bindingToFile[componentName]
        ? imports.bindingToFile[componentName]
        : imports.file;
    const params = path ? paramsFromPath(path) : [];

    routes.push({
      path,
      componentName,
      file,
      hasParams: params.length > 0,
      params,
      elementProps: elementPropsFrom(attrMap.get('element')),
    });
  }

  return routes;
}
