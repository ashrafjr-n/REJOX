/**
 * Navigation transform — react-router → React Navigation, deterministically.
 *
 * With the route table resolved by the Project Intelligence Engine
 * (options.routes), `<Link to>` is a rule, not a judgment call:
 *
 *   - static path        : <Link to="/products">        → navigate('Products')
 *   - static param path  : <Link to="/products/5">      → navigate('ProductDetail', { id: '5' })
 *   - template param path: <Link to={`/products/${x}`}> → navigate('ProductDetail', { id: x })
 *   - useParams<T>()     : → (useRoute().params ?? {}) as T
 *
 * The enclosing component gets `const navigation = useNavigation<any>()` and
 * the '@react-navigation/native' import injected. What stays residue — and
 * why it is genuinely a judgment call:
 *
 *   - NAV_LINK  : `to` is a runtime expression with no static route match
 *                 (which screen? unknowable without evaluating the program).
 *   - NAV_ACTIVE: NavLink's isActive className — active state is navigation
 *                 state; how it should look (tab bar? highlight?) is design.
 */

import { Node, SyntaxKind, type SourceFile } from 'ts-morph';
import type { Ctx, RouteOption } from '../types';
import {
  applyUntilStable,
  commentSafe,
  enclosingComponentBody,
  recordUnhandled,
  requestNamedImport,
  tagNameOf,
  type JsxTagLike,
} from '../util';

const ROUTER_LINK_TAGS = new Set(['Link', 'NavLink']);
const DROP_PROPS = new Set(['to', 'end', 'replace', 'reloadDocument']);
const NAVIGATION_MODULE = '@react-navigation/native';

// --- Path parsing / route matching ------------------------------------------

/** A `to` value parsed into path segments: static text or one embedded expr. */
type Segment = { kind: 'static'; text: string } | { kind: 'expr'; expr: string };

function splitStatic(path: string): Segment[] {
  return path
    .replace(/[?#].*$/, '')
    .split('/')
    .filter((s) => s.length > 0)
    .map((text) => ({ kind: 'static', text }) as Segment);
}

/**
 * Parse a `to` initializer into segments. Returns null when the value is not
 * statically analyzable (runtime expression) or an expression does not occupy
 * a whole path segment (e.g. `/p/x${y}z`).
 */
function parseToValue(init: Node | undefined): Segment[] | null {
  if (!init) return null;

  if (Node.isStringLiteral(init)) return splitStatic(init.getLiteralText());

  if (Node.isJsxExpression(init)) {
    const expr = init.getExpression();
    if (!expr) return null;
    if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) {
      return splitStatic(expr.getLiteralText());
    }
    if (Node.isTemplateExpression(expr)) {
      const segments: Segment[] = [];
      // Static text chunks split on '/'; an expression must occupy exactly one
      // whole path segment (…/${expr}/… or a trailing …/${expr}).
      const pushStatic = (text: string): boolean => {
        for (const chunk of text.split('/')) {
          if (chunk !== '') segments.push({ kind: 'static', text: chunk });
        }
        return true;
      };

      pushStatic(expr.getHead().getLiteralText());
      if (!expr.getHead().getLiteralText().endsWith('/')) return null;
      for (const [i, span] of expr.getTemplateSpans().entries()) {
        segments.push({ kind: 'expr', expr: span.getExpression().getText() });
        const literal = span.getLiteral().getLiteralText();
        // After an expression, static text must start a new segment (or end).
        if (literal !== '' && !literal.startsWith('/')) return null;
        pushStatic(literal);
        const isLast = i === expr.getTemplateSpans().length - 1;
        if (!isLast && !literal.endsWith('/')) return null;
      }
      return segments;
    }
  }
  return null;
}

/** Match parsed segments against the route table → screen + param bindings. */
function matchRoute(
  segments: Segment[],
  routes: RouteOption[],
): { screen: string; params: [string, string][] } | null {
  for (const route of routes) {
    const routeSegs = route.path.split('/').filter((s) => s.length > 0);
    if (routeSegs.length !== segments.length) continue;

    const params: [string, string][] = [];
    let ok = true;
    for (let i = 0; i < routeSegs.length; i++) {
      const rs = routeSegs[i];
      const ts = segments[i];
      if (rs.startsWith(':')) {
        params.push([rs.slice(1), ts.kind === 'expr' ? ts.expr : `'${ts.text}'`]);
      } else if (ts.kind !== 'static' || ts.text !== rs) {
        ok = false;
        break;
      }
    }
    if (ok) return { screen: route.screen, params };
  }
  return null;
}

function navigateCall(screen: string, params: [string, string][]): string {
  if (params.length === 0) return `navigation.navigate('${screen}')`;
  const obj = params.map(([k, v]) => `${k}: ${v}`).join(', ');
  return `navigation.navigate('${screen}', { ${obj} })`;
}

// --- Hook injection ----------------------------------------------------------

/** Ensure `const navigation = useNavigation<any>()` in the enclosing component. */
function ensureNavigationHook(el: Node, ctx: Ctx): boolean {
  const body = enclosingComponentBody(el);
  if (!body) return false; // expression-body arrow — cannot host a hook
  if (!/\buseNavigation\s*[<(]/.test(body.getText())) {
    body.insertStatements(0, 'const navigation = useNavigation<any>();');
  }
  requestNamedImport(ctx, NAVIGATION_MODULE, 'useNavigation');
  return true;
}

// --- <Link> / <NavLink> ------------------------------------------------------

interface LinkAttrs {
  kept: string;
  toInit: Node | undefined;
  toText: string;
  activeFnAttr: string | null;
}

function readAttrs(el: JsxTagLike): LinkAttrs {
  const opening = Node.isJsxElement(el) ? el.getOpeningElement() : el;
  const kept: string[] = [];
  let toInit: Node | undefined;
  let toText = '';
  let activeFnAttr: string | null = null;

  for (const attr of opening.getAttributes()) {
    if (!Node.isJsxAttribute(attr)) {
      kept.push(attr.getText()); // spread {...props}
      continue;
    }
    const name = attr.getNameNode().getText();
    if (name === 'to') {
      toInit = attr.getInitializer();
      toText = toInit ? toInit.getText() : '';
      continue;
    }
    if (DROP_PROPS.has(name)) continue;
    if (name === 'className') {
      const init = attr.getInitializer();
      if (init && Node.isJsxExpression(init)) {
        const expr = init.getExpression();
        if (expr && (Node.isArrowFunction(expr) || Node.isFunctionExpression(expr))) {
          activeFnAttr = attr.getText();
        }
      }
    }
    kept.push(attr.getText());
  }
  return { kept: kept.join(' '), toInit, toText, activeFnAttr };
}

function childrenText(el: JsxTagLike): string {
  if (Node.isJsxSelfClosingElement(el)) return '';
  return el.getJsxChildren().map((c) => c.getText()).join('');
}

function transformOneLink(sf: SourceFile, ctx: Ctx): boolean {
  const routes = ctx.options.routes ?? [];
  const tags = [
    ...sf.getDescendantsOfKind(SyntaxKind.JsxElement),
    ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
  for (const el of tags) {
    const tag = tagNameOf(el);
    if (!ROUTER_LINK_TAGS.has(tag)) continue;

    const line = el.getStartLineNumber();
    const { kept, toInit, toText, activeFnAttr } = readAttrs(el);
    const inner = childrenText(el);
    const attrs = kept ? ` ${kept}` : '';

    const segments = parseToValue(toInit);
    const match = segments ? matchRoute(segments, ctx.options.routes ? routes : []) : null;

    let replacement: string;
    if (match && ensureNavigationHook(el, ctx)) {
      // Fully resolved: the route table gave rules everything they needed.
      replacement =
        `<Pressable${attrs} onPress={() => ${navigateCall(match.screen, match.params)}}>` +
        `${inner}</Pressable>`;
    } else {
      const safeToText = commentSafe(toText);
      const todo = `{/* REJOX-TODO(NAV_LINK): wire navigation.navigate(${safeToText || '…'}) */}`;
      replacement = `<Pressable${attrs} onPress={() => {}}>${todo}${inner}</Pressable>`;
      recordUnhandled(
        ctx,
        'NAV_LINK',
        `<${tag}> at line ${line}: 'to' has no static route-table match; wire navigation.navigate(${safeToText || '…'}).`,
        replacement,
      );
    }

    el.replaceWithText(replacement);
    ctx.rnUsed.add('Pressable');

    if (activeFnAttr) {
      recordUnhandled(
        ctx,
        'NAV_ACTIVE',
        `<${tag}> at line ${line} styles by isActive; active state is navigation state — re-express (e.g. tab bar / route-focus check).`,
        activeFnAttr.slice(0, 160),
      );
    }
    return true;
  }
  return false;
}

// --- useParams → useRoute ----------------------------------------------------

function transformUseParams(sf: SourceFile, ctx: Ctx): void {
  const routerImport = sf
    .getImportDeclarations()
    .find((d) => ['react-router-dom', 'react-router'].includes(d.getModuleSpecifierValue()));
  const named = routerImport?.getNamedImports().find((n) => n.getName() === 'useParams');
  if (!named) return;

  let transformed = false;
  // Re-query after each edit to avoid stale node refs.
  for (;;) {
    const call = sf.getDescendantsOfKind(SyntaxKind.CallExpression).find((c) => {
      const expr = c.getExpression();
      return Node.isIdentifier(expr) && expr.getText() === 'useParams';
    });
    if (!call) break;
    const typeArgs = call.getTypeArguments().map((t) => t.getText());
    const cast = typeArgs.length > 0 ? typeArgs[0] : 'any';
    call.replaceWithText(`((useRoute().params ?? {}) as ${cast})`);
    transformed = true;
  }

  if (transformed) {
    requestNamedImport(ctx, NAVIGATION_MODULE, 'useRoute');
    named.remove(); // the react-router import itself is removed later
  }
}

export function transformNavigation(sf: SourceFile, ctx: Ctx): void {
  transformUseParams(sf, ctx);
  applyUntilStable(() => transformOneLink(sf, ctx));
}
