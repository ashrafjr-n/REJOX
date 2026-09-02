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
import type { Route, RouteElementProp, RouteHostState } from '../types';
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
 * Props on the route's element, each paired with the identifier it reads.
 * A spread (`{...rest}`) has no name to report, so it is recorded as `...`
 * with no binding rather than passed over in silence — that alone is enough
 * to make the route un-hoistable, which is the honest answer.
 */
function elementPropsFrom(attr: Node | undefined): RouteElementProp[] {
  const tag = elementTag(attr);
  if (!tag) return [];
  return tag.getAttributes().map((a) => {
    if (!Node.isJsxAttribute(a)) return { name: '...', binding: null };
    const name = a.getNameNode().getText();
    const init = a.getInitializer();
    if (init && Node.isJsxExpression(init)) {
      const expr = init.getExpression();
      if (expr && Node.isIdentifier(expr)) return { name, binding: expr.getText() };
    }
    return { name, binding: null };
  });
}

/** `useState` declarations in the function component that renders this route. */
function hostStateOf(tag: Node): RouteHostState[] {
  const fn = tag.getFirstAncestor(
    (a) =>
      Node.isFunctionDeclaration(a) ||
      Node.isArrowFunction(a) ||
      Node.isFunctionExpression(a),
  );
  if (!fn) return [];

  const state: RouteHostState[] = [];
  for (const decl of fn.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (!init || !Node.isCallExpression(init)) continue;
    if (init.getExpression().getText() !== 'useState') continue;

    const bindings = decl.getNameNode();
    if (!Node.isArrayBindingPattern(bindings)) continue;
    const [first, second] = bindings.getElements();
    if (!first || !Node.isBindingElement(first)) continue;

    state.push({
      value: first.getName(),
      setter: second && Node.isBindingElement(second) ? second.getName() : null,
      initializer: init.getArguments()[0]?.getText() ?? '',
    });
  }
  return state;
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
      hostState: hostStateOf(tag),
    });
  }

  return routes;
}
