/**
 * Web-storage transform (`localStorage` / `sessionStorage`).
 *
 * The Ask stage already asks WHICH store replaces browser storage; until now
 * the answer was collected and dropped, and `localStorage` shipped untouched
 * into the emitted app. It type-checks (Expo's tsconfig base includes the DOM
 * lib) and Metro bundles it happily, so nothing catches it before the device
 * does: "Property 'localStorage' doesn't exist".
 *
 * Two answers, two genuinely different problems:
 *
 *   - **MMKV** is synchronous, so the rewrite is a pure rename. `getString`
 *     returns `undefined` where `getItem` returned `null`, so the read is
 *     written `?? null` — same value, not merely a similar one.
 *   - **AsyncStorage** returns Promises, so the rename is the easy half. An
 *     un-awaited rewrite substitutes a `Promise` for a `string`: a wrong value
 *     that type-checks, survives Metro, and corrupts whatever reads it. So the
 *     `await` placement is decided from the enclosing function, never assumed:
 *
 *       A. the call is already inside an `async` function  → insert `await`
 *       B. it is inside a `useEffect` callback with no cleanup `return`
 *          → the body moves into an injected `const load = async () => {…}`
 *       C. it is inside a non-`async` function whose return value is provably
 *          never read (a JSX handler)                      → mark it `async`
 *       D. anything else → **left untouched** + `WEB_STORAGE` residue.
 *
 * D is deliberate. A `localStorage` we did not touch throws at the exact line
 * the TODO names; a silently un-awaited rewrite does not throw at all. Between
 * a loud missing answer and a quiet wrong one, the rule picks loud.
 */

import {
  Node,
  SyntaxKind,
  type ArrowFunction,
  type CallExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type Identifier,
  type SourceFile,
} from 'ts-morph';
import type { Ctx } from '../types';
import {
  applyUntilStable,
  freshName,
  recordUnhandled,
  recordWarning,
  requestDefaultImport,
  requestNamedImport,
} from '../util';

const STORAGE_GLOBALS = new Set(['localStorage', 'sessionStorage']);

const ASYNC_STORAGE_MODULE = '@react-native-async-storage/async-storage';
const MMKV_MODULE = 'react-native-mmkv';

/** The Storage methods with a real equivalent in both target stores. */
const SUPPORTED = new Set(['getItem', 'setItem', 'removeItem', 'clear']);

/** Storage method → MMKV method. MMKV does not reuse the web names. */
const MMKV_METHODS: Record<string, string> = {
  getItem: 'getString',
  setItem: 'set',
  removeItem: 'delete',
  clear: 'clearAll',
};

/** Hooks whose callback must NOT itself become async (React reads its return). */
const EFFECT_HOOKS = new Set(['useEffect', 'useLayoutEffect']);

type FunctionLike = FunctionDeclaration | FunctionExpression | ArrowFunction;

/** Where `await` can go, or `null` when no placement is provable (case D). */
type Placement = 'already-async' | 'mark-async' | null;

/** A storage call the transform can rewrite. */
interface StorageCall {
  id: Identifier;
  object: string;
  method: string;
  call: CallExpression;
}

// --- Recognising a real global read -----------------------------------------

/**
 * Is this identifier the browser global, rather than a name that merely looks
 * like it? A property (`foo.localStorage`), an object key, or a declaration's
 * own name is a different thing wearing the same text.
 */
function isGlobalRead(id: Identifier): boolean {
  const parent = id.getParent();
  if (!parent) return false;
  if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === id) return false;
  if (Node.isPropertyAssignment(parent) && parent.getNameNode() === id) return false;
  if (Node.isVariableDeclaration(parent) && parent.getNameNode() === id) return false;
  if (Node.isParameterDeclaration(parent) && parent.getNameNode() === id) return false;
  if (Node.isBindingElement(parent) && parent.getNameNode() === id) return false;
  if (id.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)) return false;
  return true;
}

/**
 * Does the file declare `name` itself? Then every use is that local binding,
 * not the browser global, and rewriting them would break working code.
 */
function isShadowed(sf: SourceFile, name: string): boolean {
  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (decl.getNameNode().getText() === name) return true;
  }
  for (const param of sf.getDescendantsOfKind(SyntaxKind.Parameter)) {
    if (param.getNameNode().getText() === name) return true;
  }
  for (const spec of sf.getDescendantsOfKind(SyntaxKind.ImportSpecifier)) {
    if (spec.getName() === name) return true;
  }
  return false;
}

/** Every live browser-storage identifier still in the file. */
function storageIdentifiers(sf: SourceFile): Identifier[] {
  const shadowed = new Set(
    [...STORAGE_GLOBALS].filter((name) => isShadowed(sf, name)),
  );
  return sf
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .filter(
      (id) =>
        STORAGE_GLOBALS.has(id.getText()) &&
        !shadowed.has(id.getText()) &&
        isGlobalRead(id),
    );
}

/**
 * The supported `localStorage.method(...)` call this identifier heads, or
 * `undefined` for anything else — `.length`, `.key(i)`, a property read, or
 * the object passed around as a value. None of those have an equivalent in
 * either target store, so none are guessed at.
 */
function asStorageCall(id: Identifier): StorageCall | undefined {
  const access = id.getParent();
  if (!Node.isPropertyAccessExpression(access) || access.getExpression() !== id) {
    return undefined;
  }
  const method = access.getName();
  if (!SUPPORTED.has(method)) return undefined;
  const call = access.getParent();
  if (!Node.isCallExpression(call) || call.getExpression() !== access) return undefined;
  return { id, object: id.getText(), method, call };
}

// --- await placement (AsyncStorage only) ------------------------------------

function enclosingFunction(node: Node): FunctionLike | undefined {
  return (
    node.getFirstAncestorByKind(SyntaxKind.ArrowFunction) ??
    node.getFirstAncestorByKind(SyntaxKind.FunctionExpression) ??
    node.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration)
  );
}

/** Is `fn` the callback of `useEffect(...)` / `useLayoutEffect(...)`? */
function isEffectCallback(fn: FunctionLike): boolean {
  const call = fn.getParent();
  if (!Node.isCallExpression(call) || call.getArguments()[0] !== fn) return false;
  const callee = call.getExpression().getText();
  const name = callee.startsWith('React.') ? callee.slice('React.'.length) : callee;
  return EFFECT_HOOKS.has(name);
}

/** Does `fn`'s own body return a value (a cleanup, in an effect)? */
function hasOwnReturn(fn: FunctionLike): boolean {
  return fn
    .getDescendantsOfKind(SyntaxKind.ReturnStatement)
    .some((ret) => enclosingFunction(ret) === fn);
}

/** Is `fn` written directly as a JSX attribute value — `onPress={() => …}`? */
function isJsxAttributeValue(node: Node): boolean {
  const expr = node.getParent();
  if (!expr || !Node.isJsxExpression(expr)) return false;
  return Node.isJsxAttribute(expr.getParent());
}

/**
 * Is this reference to a function a place where its return value is discarded?
 * Only three shapes count, and all three are handler wiring:
 *   `onPress={handle}` · `handle();` as a statement · `onPress={() => handle()}`
 * Anything else (an argument, an assignment, a `.map` callback) may read the
 * value, and turning the function async would hand it a Promise instead.
 */
function returnValueUnused(ref: Identifier): boolean {
  const parent = ref.getParent();
  if (!parent) return false;
  if (isJsxAttributeValue(ref)) return true;
  if (Node.isCallExpression(parent) && parent.getExpression() === ref) {
    const owner = parent.getParent();
    if (Node.isExpressionStatement(owner)) return true;
    // `onPress={() => handle()}` — the concise arrow returns it, but the arrow
    // is a JSX handler, so nothing downstream reads it either.
    if (Node.isArrowFunction(owner) && owner.getBody() === parent) {
      return isJsxAttributeValue(owner);
    }
  }
  return false;
}

/** Where an `await` may be placed for a call inside `fn`. */
function placementFor(sf: SourceFile, fn: FunctionLike | undefined): Placement {
  if (!fn) return null; // module scope — nothing to await inside
  if (fn.isAsync()) return 'already-async';

  // An effect callback is never marked async: React reads its return value as
  // the cleanup, and a Promise there breaks unmount. Phase 1 handles those by
  // moving the body into an inner async function instead.
  if (isEffectCallback(fn)) return null;

  if (isJsxAttributeValue(fn)) return 'mark-async';

  const decl = fn.getParent();
  if (Node.isVariableDeclaration(decl) && decl.getInitializer() === fn) {
    const name = decl.getNameNode().getText();
    const refs = sf
      .getDescendantsOfKind(SyntaxKind.Identifier)
      .filter((id) => id.getText() === name && id !== decl.getNameNode());
    if (refs.length > 0 && refs.every(returnValueUnused)) return 'mark-async';
  }
  return null;
}

// --- Rewriting ---------------------------------------------------------------

/** Operators that bind tighter than `await`, so the replacement needs parens. */
function needsParens(call: CallExpression): boolean {
  const parent = call.getParent();
  if (!parent) return false;
  if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === call) return true;
  if (Node.isElementAccessExpression(parent) && parent.getExpression() === call) return true;
  if (Node.isCallExpression(parent) && parent.getExpression() === call) return true;
  if (Node.isNonNullExpression(parent)) return true;
  if (Node.isTaggedTemplateExpression(parent)) return true;
  return false;
}

function argsOf(call: CallExpression): string {
  return call.getArguments().map((a) => a.getText()).join(', ');
}

/** One warning per rewritten call: the migration changed the shape of the code. */
function recordMapped(ctx: Ctx, sc: StorageCall, replacement: string): void {
  recordWarning(
    ctx,
    'STORAGE_MAPPED',
    `${sc.object}.${sc.method}() → ${replacement}.`,
    sc.call.getStartLineNumber(),
  );
}

/**
 * `sessionStorage` maps to the same store as `localStorage`, and neither RN
 * store is session-scoped: the data now outlives the launch that wrote it, and
 * the two keyspaces have become one. Real behaviour change, said out loud.
 */
function recordSessionPersistence(ctx: Ctx, sc: StorageCall): void {
  if (sc.object !== 'sessionStorage') return;
  recordWarning(
    ctx,
    'STORAGE_PERSISTENCE',
    'sessionStorage mapped to a persistent RN store: no React Native store is ' +
      'session-scoped, so this data now survives app restarts and shares one ' +
      "keyspace with localStorage's.",
    sc.call.getStartLineNumber(),
  );
}

// --- MMKV (synchronous — a pure rename) --------------------------------------

function transformMmkv(sf: SourceFile, ctx: Ctx): void {
  const storeName = freshName(sf, 'storage');
  let used = false;

  applyUntilStable(() => {
    for (const id of storageIdentifiers(sf)) {
      const sc = asStorageCall(id);
      if (!sc) continue; // residue — recorded in the final pass
      const args = argsOf(sc.call);
      const replacement =
        sc.method === 'getItem'
          ? // MMKV answers a missing key with `undefined`; the web API answers
            // `null`, and callers test for exactly that. `?? null` keeps the
            // value identical rather than merely similar.
            `(${storeName}.getString(${args}) ?? null)`
          : `${storeName}.${MMKV_METHODS[sc.method]}(${args})`;
      recordMapped(ctx, sc, replacement);
      recordSessionPersistence(ctx, sc);
      sc.call.replaceWithText(replacement);
      used = true;
      return true;
    }
    return false;
  });

  if (!used) return;
  requestNamedImport(ctx, MMKV_MODULE, 'MMKV');
  const imports = sf.getImportDeclarations();
  const index = imports.length > 0 ? imports[imports.length - 1].getChildIndex() + 1 : 0;
  sf.insertStatements(index, `\nconst ${storeName} = new MMKV();\n`);
}

// --- AsyncStorage (asynchronous — placement decided, never assumed) ----------

/**
 * Phase 1 — move an effect body into an injected async function.
 *
 * `useEffect(async () => …)` is the wrong fix: React treats the return value as
 * the cleanup, so an async callback hands it a Promise and unmount silently
 * stops working. The idiom is an inner async function, called immediately.
 * Only applied when the effect returns nothing of its own — moving a real
 * cleanup inside the wrapper would unregister it.
 */
function wrapOneEffect(sf: SourceFile, ctx: Ctx): boolean {
  for (const id of storageIdentifiers(sf)) {
    if (!asStorageCall(id)) continue;
    const fn = enclosingFunction(id);
    if (!fn || fn.isAsync() || !isEffectCallback(fn)) continue;
    const body = fn.getBody();
    if (!body || !Node.isBlock(body)) continue;
    if (hasOwnReturn(fn)) continue; // a cleanup — case D, left alone

    const runName = freshName(sf, 'load');
    const inner = body.getText().replace(/^\{/, '').replace(/\}$/, '');
    body.replaceWithText(
      `{\nconst ${runName} = async () => {${inner}};\n${runName}();\n}`,
    );
    recordWarning(
      ctx,
      'STORAGE_ASYNC_EFFECT',
      `Effect body moved into an async ${runName}() so the storage read can be ` +
        'awaited; the effect itself stays synchronous so React can still read a cleanup.',
      fn.getStartLineNumber(),
    );
    return true;
  }
  return false;
}

function transformAsyncStorage(sf: SourceFile, ctx: Ctx): void {
  applyUntilStable(() => wrapOneEffect(sf, ctx));

  const local = freshName(sf, 'AsyncStorage');
  let used = false;

  applyUntilStable(() => {
    for (const id of storageIdentifiers(sf)) {
      const sc = asStorageCall(id);
      if (!sc) continue;
      const fn = enclosingFunction(id);
      const placement = placementFor(sf, fn);
      if (placement === null) continue; // case D — left untouched, residue below
      if (placement === 'mark-async' && fn) fn.setIsAsync(true);

      const awaited = `await ${local}.${sc.method}(${argsOf(sc.call)})`;
      const replacement = needsParens(sc.call) ? `(${awaited})` : awaited;
      recordMapped(ctx, sc, replacement);
      recordSessionPersistence(ctx, sc);
      sc.call.replaceWithText(replacement);
      used = true;
      return true;
    }
    return false;
  });

  if (used) requestDefaultImport(ctx, ASYNC_STORAGE_MODULE, local);
}

// --- Residue -----------------------------------------------------------------

/**
 * Why THIS storage use was left alone. Each case gets its own sentence: a
 * generic "could not be converted" makes the reader re-derive what the
 * transform already knew, and the fix differs per case.
 */
function placementReason(id: Identifier): string {
  const fn = enclosingFunction(id);
  if (!fn) return 'it is read at module scope, where nothing can be awaited';
  if (isEffectCallback(fn)) {
    return (
      'the useEffect around it returns a cleanup, which cannot move into the ' +
      'async wrapper without unregistering it'
    );
  }
  const decl = fn.getParent();
  if (Node.isVariableDeclaration(decl) && decl.getInitializer() === fn) {
    return (
      `${decl.getNameNode().getText()}() cannot be made async: its return ` +
      'value is read somewhere, and it would become a Promise'
    );
  }
  return (
    'it is read during render (a hook argument or the component body), which ' +
    'cannot be async — move it into an effect that sets state'
  );
}

/** Why this particular storage use was left alone — named, never generic. */
function residueReason(id: Identifier, mmkv: boolean): string {
  const sc = asStorageCall(id);
  if (!sc) {
    const access = id.getParent();
    const member =
      Node.isPropertyAccessExpression(access) && access.getExpression() === id
        ? `.${access.getName()}`
        : ' used as a value';
    return (
      `${id.getText()}${member} has no equivalent in the chosen React Native ` +
      'store — neither AsyncStorage nor MMKV exposes the browser Storage ' +
      'interface (length/key/property access).'
    );
  }
  if (mmkv) return `${sc.object}.${sc.method}() could not be rewritten.`;
  return (
    `${sc.object}.${sc.method}() left as-is: ${placementReason(id)}. ` +
    'AsyncStorage returns a Promise, and rewriting this un-awaited would ' +
    'substitute the Promise for the value.'
  );
}

export function transformStorage(sf: SourceFile, ctx: Ctx): void {
  if (storageIdentifiers(sf).length === 0) return;

  const mmkv = ctx.options.storage === 'mmkv';
  if (mmkv) transformMmkv(sf, ctx);
  else transformAsyncStorage(sf, ctx);

  // Whatever still says `localStorage` after the rewrite is what rules could
  // not resolve. It stays in the code, exactly where it was, with a TODO
  // naming it — a loud runtime failure at a known line beats a silent one.
  for (const id of storageIdentifiers(sf)) {
    recordUnhandled(ctx, 'WEB_STORAGE', residueReason(id, mmkv), id.getParent()?.getText() ?? id.getText());
  }
}
