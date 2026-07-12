/**
 * Hook extraction.
 *
 * Finds the project's own custom hooks — module-scope function-like definitions
 * whose name matches the `useX` convention — and computes which components use
 * each one (from the components' `hooksUsed`). Built-in React hooks are not
 * listed here; their usage is captured per-component in `hooksUsed`.
 */

import { type SourceFile } from 'ts-morph';
import { isHookName, topLevelFunctions } from '../util';
import type { Component, Hook } from '../types';

export function hookId(file: string, name: string): string {
  return `${file}#${name}`;
}

export interface HookDefinition {
  name: string;
  file: string;
}

/** Custom hook definitions declared in a single source file. */
export function findHookDefinitions(
  sourceFile: SourceFile,
  fileRel: string,
): HookDefinition[] {
  const defs: HookDefinition[] = [];
  for (const { name } of topLevelFunctions(sourceFile)) {
    if (isHookName(name)) defs.push({ name, file: fileRel });
  }
  return defs;
}

/** Assemble the Hook nodes, wiring `usedBy` from the extracted components. */
export function buildHooks(
  definitions: HookDefinition[],
  components: Component[],
): Hook[] {
  const customNames = new Set(definitions.map((d) => d.name));

  return definitions.map((def) => {
    const usedBy = components
      .filter((c) => c.hooksUsed.includes(def.name))
      .map((c) => c.name)
      .sort();
    return {
      id: hookId(def.file, def.name),
      name: def.name,
      file: def.file,
      isCustom: customNames.has(def.name), // all definitions here are custom
      usedBy,
    };
  });
}
