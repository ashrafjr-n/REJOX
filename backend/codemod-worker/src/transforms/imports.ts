/**
 * Import transform (runs last, after all other transforms):
 *   - drop react-router-dom / react-dom imports; router hooks STILL referenced
 *     after the navigation transform become NAV_HOOK residue, and router
 *     structure components used in JSX (Routes/Route/Outlet/…) become
 *     NAV_CONTAINER residue — navigator structure is a judgment call, and
 *     nothing is ever silently dropped.
 *   - flag CSS-Module imports (kept verbatim; restyling needs judgment)
 *   - drop plain stylesheet imports (+ GLOBAL_CSS residue): RN has no
 *     stylesheet imports, and the file is never emitted
 *   - flag web-only React DOM types that survived the props-type transform
 *   - inject `import { … } from 'react-native'` for every RN component used
 *   - inject the named imports other transforms requested
 *     (e.g. useNavigation/useRoute from '@react-navigation/native')
 *   - inject the default imports other transforms requested
 *     (AsyncStorage from '@react-native-async-storage/async-storage')
 */

import { SyntaxKind, type SourceFile } from 'ts-morph';
import type { Ctx } from '../types';
import { RN_COMPONENTS, ROUTER_HOOKS } from '../maps';
import { recordUnhandled, recordWarning } from '../util';

const CSS_MODULE_RE = /\.module\.(css|scss|sass|less)$/;
const STYLESHEET_RE = /\.(css|scss|sass|less)$/;
const DOM_TYPE_RE = /HTMLAttributes|HTML[A-Za-z]*Element|SVGProps|MouseEvent|ChangeEvent|FormEvent|KeyboardEvent/;

/** react-router components that define navigator STRUCTURE — a design call. */
const ROUTER_CONTAINERS = new Set([
  'Routes', 'Route', 'Outlet', 'Navigate', 'BrowserRouter', 'HashRouter',
  'MemoryRouter', 'RouterProvider',
]);

function collectRnUsed(sf: SourceFile, ctx: Ctx): Set<string> {
  const used = new Set(ctx.rnUsed);
  const tags = [
    ...sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
  for (const el of tags) {
    const tag = el.getTagNameNode().getText();
    if (RN_COMPONENTS.has(tag)) used.add(tag);
  }
  return used;
}

/** Is `name` referenced anywhere outside import declarations? */
function referencedOutsideImports(sf: SourceFile, name: string): boolean {
  for (const id of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (id.getText() !== name) continue;
    if (id.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)) continue;
    return true;
  }
  return false;
}

/**
 * Inject `import NAME from 'module'` unless the file already imports that
 * module with a default binding (in which case the file's own name wins — the
 * transforms asked for the module, not for a second binding to it).
 */
function ensureDefaultImport(sf: SourceFile, module: string, name: string): void {
  const existing = sf
    .getImportDeclarations()
    .find((d) => d.getModuleSpecifierValue() === module);
  if (!existing) {
    sf.insertImportDeclaration(0, { moduleSpecifier: module, defaultImport: name });
    return;
  }
  if (!existing.getDefaultImport()) existing.setDefaultImport(name);
}

function ensureNamedImports(sf: SourceFile, module: string, names: Iterable<string>): void {
  const wanted = [...names].sort();
  if (wanted.length === 0) return;
  const existing = sf
    .getImportDeclarations()
    .find((d) => d.getModuleSpecifierValue() === module);
  if (existing) {
    const have = new Set(existing.getNamedImports().map((n) => n.getName()));
    for (const name of wanted) if (!have.has(name)) existing.addNamedImport(name);
  } else {
    sf.insertImportDeclaration(0, { moduleSpecifier: module, namedImports: wanted });
  }
}

export function transformImports(sf: SourceFile, ctx: Ctx): void {
  for (const imp of [...sf.getImportDeclarations()]) {
    const mod = imp.getModuleSpecifierValue();
    const line = imp.getStartLineNumber();

    if (mod === 'react-router-dom' || mod === 'react-router') {
      for (const named of imp.getNamedImports()) {
        const name = named.getName();
        if (!referencedOutsideImports(sf, name)) continue; // fully transformed away
        if (ROUTER_HOOKS.has(name)) {
          recordUnhandled(
            ctx,
            'NAV_HOOK',
            `${name}() has no direct RN equivalent; use React Navigation (e.g. useRoute/useNavigation).`,
            name,
          );
        } else if (ROUTER_CONTAINERS.has(name)) {
          recordUnhandled(
            ctx,
            'NAV_CONTAINER',
            `<${name}> defines router structure; re-express as a React Navigation navigator (see the migration plan's navigation step).`,
            name,
          );
        }
      }
      imp.remove();
      continue;
    }

    if (mod === 'react-dom' || mod === 'react-dom/client') {
      recordWarning(ctx, 'WEB_ONLY_IMPORT', `Removed web-only import '${mod}'.`, line);
      imp.remove();
      continue;
    }

    if (CSS_MODULE_RE.test(mod)) {
      recordUnhandled(
        ctx,
        'CSS_MODULE',
        `CSS Module '${mod}' must be hand-converted to a StyleSheet/NativeWind; import kept for now.`,
        imp.getText(),
      );
      continue; // keep the import (className preserved verbatim)
    }

    if (STYLESHEET_RE.test(mod)) {
      // A plain stylesheet import is side-effect-only and has no React Native
      // equivalent — the file itself is never emitted. Dropping it silently is
      // how a project's whole design layer disappears without a trace, so the
      // residue names the stylesheet at the call site that lost it.
      recordUnhandled(
        ctx,
        'GLOBAL_CSS',
        `Global stylesheet '${mod}' has no React Native equivalent; its rules must be re-expressed as NativeWind classes or a StyleSheet.`,
        imp.getText(),
      );
      imp.remove();
      continue;
    }

    if (mod === 'react') {
      for (const named of imp.getNamedImports()) {
        if (DOM_TYPE_RE.test(named.getName())) {
          recordUnhandled(
            ctx,
            'PROPS_HTML_TYPE',
            `Web DOM type '${named.getName()}' from 'react' is invalid in RN; reshape props (e.g. PressableProps).`,
            named.getText(),
          );
        }
      }
    }
  }

  // Inject the react-native import for everything now used, plus whatever the
  // other transforms requested (navigation hooks, RN props types, ...).
  const rnNames = new Set(collectRnUsed(sf, ctx));
  for (const name of ctx.namedImports.get('react-native') ?? []) rnNames.add(name);
  ensureNamedImports(sf, 'react-native', rnNames);
  for (const [module, names] of ctx.namedImports) {
    if (module === 'react-native') continue;
    ensureNamedImports(sf, module, names);
  }
  for (const [module, name] of ctx.defaultImports) {
    ensureDefaultImport(sf, module, name);
  }
}
