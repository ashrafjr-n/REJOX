/**
 * Import transform (runs last, after JSX is fully converted):
 *   - drop react-router-dom / react-dom imports (routers/hooks become TODOs)
 *   - flag CSS-Module imports (kept verbatim; styling is Part 2)
 *   - flag web-only React DOM types (e.g. ButtonHTMLAttributes)
 *   - inject a single `react-native` import for every RN component now used
 */

import { Node, SyntaxKind, type SourceFile } from 'ts-morph';
import type { Ctx } from '../types';
import { RN_COMPONENTS, ROUTER_HOOKS } from '../maps';
import { recordUnhandled, recordWarning } from '../util';

const CSS_MODULE_RE = /\.module\.(css|scss|sass|less)$/;
const DOM_TYPE_RE = /HTMLAttributes|HTML[A-Za-z]*Element|SVGProps|MouseEvent|ChangeEvent|FormEvent|KeyboardEvent/;

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

export function transformImports(sf: SourceFile, ctx: Ctx): void {
  for (const imp of [...sf.getImportDeclarations()]) {
    const mod = imp.getModuleSpecifierValue();
    const line = imp.getStartLineNumber();

    if (mod === 'react-router-dom' || mod === 'react-router') {
      for (const named of imp.getNamedImports()) {
        const name = named.getName();
        if (ROUTER_HOOKS.has(name)) {
          recordUnhandled(
            ctx,
            'NAV_HOOK',
            `${name}() has no direct RN equivalent; use React Navigation (e.g. useRoute/useNavigation).`,
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

  // Inject the react-native import for everything now used.
  const used = [...collectRnUsed(sf, ctx)].sort();
  if (used.length > 0) {
    const existing = sf
      .getImportDeclarations()
      .find((d) => d.getModuleSpecifierValue() === 'react-native');
    if (existing) {
      const have = new Set(existing.getNamedImports().map((n) => n.getName()));
      for (const name of used) if (!have.has(name)) existing.addNamedImport(name);
    } else {
      sf.insertImportDeclaration(0, {
        moduleSpecifier: 'react-native',
        namedImports: used,
      });
    }
  }
}
