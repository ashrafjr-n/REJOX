/**
 * Build-time environment transform.
 *
 * `import.meta` is a bundler feature, not a language runtime one: Vite replaces
 * `import.meta.env.VITE_X` with a literal at build time. Metro does not support
 * the syntax at all — it fails the whole bundle on the first occurrence
 * ("'import.meta' is currently unsupported"), so a single surviving read costs
 * the app, not one value. Nothing here may be left in place.
 *
 * Expo has the same mechanism under a different name: `process.env.EXPO_PUBLIC_X`,
 * inlined by babel-preset-expo — but only when it is written out in full, so the
 * replacement is always a complete member expression, never a destructured or
 * aliased read.
 *
 * Only a statically-known key can be rewritten. Everything else about
 * `import.meta` (a dynamic key, the whole `env` object, `.url`/`.hot`/`.glob`)
 * becomes BUILD_ENV residue: where such a value comes from once the bundler
 * constant is gone is app configuration, not a rename.
 */

import { Node, SyntaxKind, type SourceFile } from 'ts-morph';
import type { Ctx } from '../types';
import { applyUntilStable, commentSafe, recordUnhandled, recordWarning } from '../util';

/** Vite's own `import.meta.env` members — build flags, not user variables. */
const BUILT_INS: Record<string, string> = {
  DEV: '__DEV__',
  // Parenthesised: the replacement inherits the original read's position in
  // whatever expression surrounded it, and `!` binds tighter than most of what
  // can be there.
  PROD: '(!__DEV__)',
  MODE: "(__DEV__ ? 'development' : 'production')",
  // A native app is never server-rendered.
  SSR: 'false',
};

/** A key `process.env.<KEY>` can actually be written as — Metro inlines no other form. */
const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** `VITE_` is Vite's "safe to expose to the client" marker; `EXPO_PUBLIC_` is Expo's. */
function envKey(key: string): string {
  return `EXPO_PUBLIC_${key.replace(/^VITE_/, '')}`;
}

/** The statically-known key of `…env.KEY` / `…env['KEY']`, else undefined. */
function staticKey(node: Node): string | undefined {
  if (Node.isPropertyAccessExpression(node)) return node.getName();
  if (Node.isElementAccessExpression(node)) {
    const arg = node.getArgumentExpression();
    return arg && Node.isStringLiteral(arg) ? arg.getLiteralValue() : undefined;
  }
  return undefined;
}

function isImportMeta(node: Node): boolean {
  // `new.target` is a MetaProperty too.
  return node.getKind() === SyntaxKind.MetaProperty && node.getText() === 'import.meta';
}

function transformOne(sf: SourceFile, ctx: Ctx): boolean {
  for (const meta of sf.getDescendantsOfKind(SyntaxKind.MetaProperty)) {
    if (!isImportMeta(meta)) continue;

    const parent = meta.getParent();
    const line = meta.getStartLineNumber();

    // `import.meta.env.KEY` / `import.meta.env['KEY']`
    if (Node.isPropertyAccessExpression(parent) && parent.getName() === 'env') {
      const read = parent.getParent();
      const key = read ? staticKey(read) : undefined;
      if (read && key !== undefined) {
        const builtIn = BUILT_INS[key];
        const replacement = builtIn ?? (IDENTIFIER_RE.test(key) ? `process.env.${envKey(key)}` : undefined);
        if (replacement !== undefined) {
          const before = read.getText();
          recordWarning(
            ctx,
            'ENV_VAR_MAPPED',
            builtIn
              ? `${commentSafe(before)} → ${replacement} (React Native's own build flag).`
              : `${commentSafe(before)} → ${replacement} — set ${envKey(key)} in the app's .env; the value is not carried over.`,
            line,
          );
          read.replaceWithText(replacement);
          return true;
        }
      }
    }

    // Everything else: no static key to rewrite. The read still cannot stay —
    // Metro rejects the syntax outright — so it is replaced by the nearest
    // truthful thing and named as residue.
    const isEnvBag = Node.isPropertyAccessExpression(parent) && parent.getName() === 'env';
    const target =
      Node.isPropertyAccessExpression(parent) || Node.isElementAccessExpression(parent)
        ? parent
        : meta;
    const snippet = target.getText();
    // The whole `env` bag becomes `process.env`: same shape, still type-checks,
    // and the code keeps running. What it is NOT is equivalent — babel-preset-expo
    // inlines `process.env.EXPO_PUBLIC_X` written out in full and nothing else, so
    // a destructured or dynamic read is `undefined` at runtime until someone
    // rewrites it. Anything else has no analogue at all.
    recordUnhandled(
      ctx,
      'BUILD_ENV',
      isEnvBag
        ? `${commentSafe(snippet)} read as a whole (dynamic or destructured key) → process.env. ` +
            'Expo only inlines a full process.env.EXPO_PUBLIC_<KEY> expression, so each read has to become one.'
        : `${commentSafe(snippet)} has no React Native equivalent, and Metro cannot bundle 'import.meta' at ` +
            'all — replaced with undefined. Supply the value through process.env.EXPO_PUBLIC_* or native config.',
      snippet,
    );
    target.replaceWithText(isEnvBag ? 'process.env' : 'undefined');
    return true;
  }
  return false;
}

export function transformEnv(sf: SourceFile, ctx: Ctx): void {
  applyUntilStable(() => transformOne(sf, ctx));
}
