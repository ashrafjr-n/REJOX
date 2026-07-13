/**
 * Props-type transform: web DOM attribute interfaces → RN component props.
 *
 * `interface P extends ButtonHTMLAttributes<HTMLButtonElement>` is a
 * declarative HTML-interface → RN-interface mapping, not a judgment call:
 * the element the props land on is known (button → Pressable), so the props
 * type is too. Handles interface heritage clauses and type-alias
 * intersections; the replaced DOM type import is removed from 'react' and the
 * RN type is imported from 'react-native'.
 *
 * DOM types with no clean RN equivalent stay put — the imports transform
 * flags them as PROPS_HTML_TYPE residue.
 */

import { Node, SyntaxKind, type SourceFile } from 'ts-morph';
import type { Ctx } from '../types';
import { recordWarning, requestNamedImport } from '../util';

/** HTML attribute interface → RN props type (mirrors ELEMENT_MAP targets). */
export const DOM_PROPS_TYPE_MAP: Record<string, string> = {
  ButtonHTMLAttributes: 'PressableProps',
  AnchorHTMLAttributes: 'PressableProps',
  InputHTMLAttributes: 'TextInputProps',
  TextareaHTMLAttributes: 'TextInputProps',
  ImgHTMLAttributes: 'ImageProps',
  FormHTMLAttributes: 'ViewProps',
  HTMLAttributes: 'ViewProps',
};

const baseName = (text: string) => text.replace(/<.*$/s, '').trim();

export function transformPropsTypes(sf: SourceFile, ctx: Ctx): void {
  const replaced = new Set<string>();

  // interface P extends ButtonHTMLAttributes<HTMLButtonElement> { … }
  // One mutation per pass; re-query until stable (edits invalidate node refs).
  for (;;) {
    let mutated = false;
    for (const iface of sf.getInterfaces()) {
      for (const ext of iface.getExtends()) {
        const base = baseName(ext.getText());
        const mapped = DOM_PROPS_TYPE_MAP[base];
        if (!mapped) continue;
        const line = ext.getStartLineNumber();
        iface.removeExtends(ext);
        iface.addExtends(mapped);
        replaced.add(base);
        requestNamedImport(ctx, 'react-native', mapped);
        recordWarning(
          ctx,
          'PROPS_TYPE_MAPPED',
          `${base} → ${mapped} on interface ${iface.getName()} (DOM props become RN props).`,
          line,
        );
        mutated = true;
        break;
      }
      if (mutated) break;
    }
    if (mutated) continue;

    // type P = { … } & ButtonHTMLAttributes<HTMLButtonElement>
    for (const alias of sf.getTypeAliases()) {
      const typeNode = alias.getTypeNode();
      if (!typeNode || !Node.isIntersectionTypeNode(typeNode)) continue;
      for (const part of typeNode.getTypeNodes()) {
        if (!Node.isTypeReference(part)) continue;
        const base = baseName(part.getText());
        const mapped = DOM_PROPS_TYPE_MAP[base];
        if (!mapped) continue;
        const line = part.getStartLineNumber();
        part.replaceWithText(mapped);
        replaced.add(base);
        requestNamedImport(ctx, 'react-native', mapped);
        recordWarning(
          ctx,
          'PROPS_TYPE_MAPPED',
          `${base} → ${mapped} on type ${alias.getName()} (DOM props become RN props).`,
          line,
        );
        mutated = true;
        break;
      }
      if (mutated) break;
    }
    if (!mutated) break;
  }

  // Drop the now-unused DOM type names from the 'react' import.
  if (replaced.size === 0) return;
  for (const imp of sf.getImportDeclarations()) {
    if (imp.getModuleSpecifierValue() !== 'react') continue;
    for (const named of [...imp.getNamedImports()]) {
      if (replaced.has(named.getName())) named.remove();
    }
    if (imp.getNamedImports().length === 0 && !imp.getDefaultImport() && !imp.getNamespaceImport()) {
      imp.remove();
    }
  }
}
