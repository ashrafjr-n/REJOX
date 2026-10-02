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
  if (Node.isJsxExpression(init)) return parsePathExpr(init.getExpression());
  return parsePathExpr(init);
}

/** The same parse for a plain expression — a `to` value or a `navigate()` argument. */
function parsePathExpr(expr: Node | undefined): Segment[] | null {
  if (!expr) return null;
  if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) {
    return splitStatic(expr.getLiteralText());
  }
  if (!Node.isTemplateExpression(expr)) return null;

  const segments: Segment[] = [];
  // Static text chunks split on '/'; an expression must occupy exactly one
  // whole path segment (…/${expr}/… or a trailing …/${expr}).
  const pushStatic = (text: string): void => {
    for (const chunk of text.split('/')) {
      if (chunk !== '') segments.push({ kind: 'static', text: chunk });
    }
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
  keptNames: string[];
  toInit: Node | undefined;
  toText: string;
  activeFnAttr: string | null;
}

function readAttrs(el: JsxTagLike): LinkAttrs {
  const opening = Node.isJsxElement(el) ? el.getOpeningElement() : el;
  const kept: string[] = [];
  const keptNames: string[] = [];
  let toInit: Node | undefined;
  let toText = '';
  let activeFnAttr: string | null = null;

  for (const attr of opening.getAttributes()) {
    if (!Node.isJsxAttribute(attr)) {
      kept.push(attr.getText()); // spread {...props}
      keptNames.push('...');
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
    keptNames.push(name);
  }
  return { kept: kept.join(' '), keptNames, toInit, toText, activeFnAttr };
}

function childrenText(el: JsxTagLike): string {
  if (Node.isJsxSelfClosingElement(el)) return '';
  return el.getJsxChildren().map((c) => c.getText()).join('');
}

/**
 * The Link's only child, when that child is itself pressable and takes the
 * navigation directly: a `<button>`, or a project component whose props the
 * graph proved are DOM button props (it becomes Pressable-backed). Wrapping
 * such a child in another Pressable makes a Pressable inside a Pressable —
 * the inner one takes the touch, and the navigation never fires.
 */
function pressableLoneChild(el: JsxTagLike, ctx: Ctx): JsxTagLike | null {
  if (Node.isJsxSelfClosingElement(el)) return null;
  const children = el
    .getJsxChildren()
    .filter((c) => !(Node.isJsxText(c) && c.getText().trim() === ''));
  if (children.length !== 1) return null;
  const [child] = children;
  if (!Node.isJsxElement(child) && !Node.isJsxSelfClosingElement(child)) return null;
  const tag = tagNameOf(child);
  const pressable = tag === 'button' || ctx.options.componentEvents?.[tag]?.onClick === 'onPress';
  if (!pressable) return null;
  const opening = Node.isJsxElement(child) ? child.getOpeningElement() : child;
  const taken = opening
    .getAttributes()
    .some((a) => Node.isJsxAttribute(a) && ['onClick', 'onPress'].includes(a.getNameNode().getText()));
  return taken ? null : child;
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
    const { kept, keptNames, toInit, toText, activeFnAttr } = readAttrs(el);
    const inner = childrenText(el);
    const attrs = kept ? ` ${kept}` : '';

    const segments = parseToValue(toInit);
    const match = segments ? matchRoute(segments, ctx.options.routes ? routes : []) : null;
    // Only a bare Link (at most a `key`) can hand its press to the child: any
    // other attribute (a className, a spread) belongs on a wrapper.
    const lone = keptNames.every((n) => n === 'key') ? pressableLoneChild(el, ctx) : null;

    let replacement: string;
    if (match && lone && ensureNavigationHook(el, ctx)) {
      const opening = Node.isJsxElement(lone) ? lone.getOpeningElement() : lone;
      opening.addAttribute({
        name: 'onPress',
        initializer: `{() => ${navigateCall(match.screen, match.params)}}`,
      });
      const key = keptNames.includes('key') ? ` ${kept}` : '';
      replacement = key ? lone.getText().replace(/^<([\w.]+)/, `<$1${key}`) : lone.getText();
    } else if (match && ensureNavigationHook(el, ctx)) {
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
    if (replacement.startsWith('<Pressable')) ctx.rnUsed.add('Pressable');

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

// --- useNavigate → useNavigation ---------------------------------------------

/** Hooks whose dependency array may list the navigate function. */
const DEPS_HOOKS = new Set(['useEffect', 'useLayoutEffect', 'useCallback', 'useMemo']);

function isDepsArrayEntry(id: Node): boolean {
  const array = id.getParent();
  if (!array || !Node.isArrayLiteralExpression(array)) return false;
  const call = array.getParent();
  return (
    call !== undefined &&
    Node.isCallExpression(call) &&
    DEPS_HOOKS.has(call.getExpression().getText()) &&
    call.getArguments()[call.getArguments().length - 1] === array
  );
}

/**
 * The React Navigation form of one `navigate(...)` call, or null when the
 * target is a runtime value: `navigate(-1)` → `goBack()`, a path the route
 * table matches → `navigate('Screen', { params })`.
 */
function navigateCallFor(args: Node[], routes: RouteOption[]): string | null {
  if (args.length !== 1) return null; // `{ replace, state }` options: a decision
  const [arg] = args;
  if (arg.getText().replace(/\s+/g, '') === '-1') return 'navigation.goBack()';
  const segments = parsePathExpr(arg);
  const match = segments ? matchRoute(segments, routes) : null;
  return match ? navigateCall(match.screen, match.params) : null;
}

/**
 * `const navigate = useNavigate()` → the component's `navigation`.
 *
 * Every call is rewritten: a path the route table matches (or `-1`) becomes
 * the exact React Navigation call; anything else becomes
 * `navigation.navigate(<the same argument>)` with a NAV_HOOK TODO naming it —
 * the file still type-checks (React Navigation's object is typed `any` here),
 * and the TODO says which screen is still unknown. A hook dependency entry
 * becomes `navigation` itself; any other use of the function (passed as a
 * prop, stored) becomes a wrapper that forwards to it, also flagged.
 */
function transformUseNavigate(sf: SourceFile, ctx: Ctx): void {
  const routes = ctx.options.routes ?? [];
  for (;;) {
    const decl = sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration).find((d) => {
      const init = d.getInitializer();
      return (
        init !== undefined &&
        Node.isCallExpression(init) &&
        init.getExpression().getText() === 'useNavigate' &&
        Node.isIdentifier(d.getNameNode())
      );
    });
    if (!decl) return;
    const body = enclosingComponentBody(decl);
    const statement = decl.getVariableStatement();
    if (!body || !statement || statement.getDeclarations().length !== 1) {
      return; // cannot host the hook here: imports.ts reports it as NAV_HOOK
    }
    const binding = decl.getName();
    const declName = decl.getNameNode();

    // Rewrite the uses deepest-last-first, so earlier positions stay valid.
    const uses = body
      .getDescendantsOfKind(SyntaxKind.Identifier)
      .filter((id) => id.getText() === binding && id !== declName)
      .reverse();
    for (const id of uses) {
      const parent = id.getParent();
      const line = id.getStartLineNumber();
      if (parent && Node.isCallExpression(parent) && parent.getExpression() === id) {
        const args = parent.getArguments();
        const exact = navigateCallFor(args, routes);
        if (exact) {
          parent.replaceWithText(exact);
          continue;
        }
        const argText = args.map((a) => a.getText()).join(', ');
        recordUnhandled(
          ctx,
          'NAV_HOOK',
          `${binding}(${commentSafe(argText)}) at line ${line}: no static route-table match — now navigation.navigate(…) with the same argument; name the screen it should open.`,
          parent.getText(),
        );
        parent.replaceWithText(`navigation.navigate(${argText})`);
      } else if (isDepsArrayEntry(id)) {
        id.replaceWithText('navigation');
      } else {
        recordUnhandled(
          ctx,
          'NAV_HOOK',
          `${binding} at line ${line} is passed on as a value — it now forwards to navigation.navigate(…); check what its callers pass.`,
          id.getText(),
        );
        id.replaceWithText('((...args: any[]) => navigation.navigate(...args))');
      }
    }

    statement.remove();
    ensureNavigationHook(body, ctx);
  }
}

// --- <a href> with a target a rule can open ---------------------------------

const EXTERNAL_URL = /^(https?:|mailto:|tel:|sms:)/i;

/**
 * `<a href>` whose target is certain becomes a press handler, while the tag is
 * still `a` (the elements pass then makes it a Pressable, with nothing left to
 * flag): an absolute URL opens with `Linking.openURL`, an in-app path the route
 * table matches navigates to its screen. Every other href is left for the
 * elements pass, which flags it.
 */
function transformOneAnchor(sf: SourceFile, ctx: Ctx): boolean {
  const routes = ctx.options.routes ?? [];
  const tags = [
    ...sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
  for (const opening of tags) {
    if (opening.getTagNameNode().getText() !== 'a') continue;
    const attrs = opening.getAttributes().filter(Node.isJsxAttribute);
    const href = attrs.find((a) => a.getNameNode().getText() === 'href');
    if (!href) continue;
    if (attrs.some((a) => ['onClick', 'onPress'].includes(a.getNameNode().getText()))) continue;

    const init = href.getInitializer();
    const value = init && Node.isJsxExpression(init) ? init.getExpression() : init;
    if (!value || !(Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value))) {
      continue;
    }
    const url = value.getLiteralText();

    let press: string | null = null;
    if (EXTERNAL_URL.test(url)) {
      press = `Linking.openURL(${JSON.stringify(url)})`;
      requestNamedImport(ctx, 'react-native', 'Linking');
    } else if (url.startsWith('/')) {
      const match = matchRoute(splitStatic(url), routes);
      if (match && ensureNavigationHook(opening, ctx)) press = navigateCall(match.screen, match.params);
    }
    if (press === null) continue;

    href.remove();
    opening.addAttribute({ name: 'onPress', initializer: `{() => ${press}}` });
    return true;
  }
  return false;
}

export function transformNavigation(sf: SourceFile, ctx: Ctx): void {
  transformUseParams(sf, ctx);
  transformUseNavigate(sf, ctx);
  applyUntilStable(() => transformOneAnchor(sf, ctx));
  applyUntilStable(() => transformOneLink(sf, ctx));
}
