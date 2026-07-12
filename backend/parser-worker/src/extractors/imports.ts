/**
 * Import extraction.
 *
 * Records, per source file, what it imports — both external packages and
 * same-project files. Downstream this powers route→component resolution,
 * the `imports` edges, and asset reference tracking.
 */

import { type SourceFile } from 'ts-morph';
import { resolveLocalImport } from '../util';

export interface ImportBinding {
  /** Local name bound in the importing file (e.g. `HomePage`, `styles`). */
  local: string;
  /** Imported name from the module (`default`, `*`, or the exported name). */
  imported: string;
}

export interface FileImports {
  file: string;
  /** Raw module specifiers, in source order. */
  specifiers: string[];
  /** Named / default / namespace bindings. */
  bindings: ImportBinding[];
  /** specifier → resolved same-project file (POSIX rel), when resolvable. */
  localTargets: Record<string, string>;
  /** local binding name → resolved same-project file. */
  bindingToFile: Record<string, string>;
}

export function extractImports(
  sourceFile: SourceFile,
  fileRel: string,
  allFilesRel: Set<string>,
): FileImports {
  const result: FileImports = {
    file: fileRel,
    specifiers: [],
    bindings: [],
    localTargets: {},
    bindingToFile: {},
  };

  for (const imp of sourceFile.getImportDeclarations()) {
    const specifier = imp.getModuleSpecifierValue();
    result.specifiers.push(specifier);

    const resolved = resolveLocalImport(fileRel, specifier, allFilesRel);
    if (resolved) result.localTargets[specifier] = resolved;

    const bindings: ImportBinding[] = [];
    const def = imp.getDefaultImport();
    if (def) bindings.push({ local: def.getText(), imported: 'default' });

    const ns = imp.getNamespaceImport();
    if (ns) bindings.push({ local: ns.getText(), imported: '*' });

    for (const named of imp.getNamedImports()) {
      const local = named.getAliasNode()?.getText() ?? named.getName();
      bindings.push({ local, imported: named.getName() });
    }

    for (const b of bindings) {
      result.bindings.push(b);
      if (resolved) result.bindingToFile[b.local] = resolved;
    }
  }

  return result;
}
