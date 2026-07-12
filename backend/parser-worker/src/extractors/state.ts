/**
 * State-management extraction.
 *
 * Detects Zustand stores — `const useX = create(...)` where `create` is the
 * import from `zustand` — and reads the top-level keys of the state object the
 * store factory returns. Also flags React Context usage (`createContext`).
 *
 * `usedBy` is wired later by the caller from components' `hooksUsed`.
 */

import { Node, SyntaxKind, type SourceFile } from 'ts-morph';
import type { FileImports } from './imports';

export interface StoreDefinition {
  name: string;
  file: string;
  stateKeys: string[];
}

export interface StateFindings {
  zustandStores: StoreDefinition[];
  usesZustand: boolean;
  usesContext: boolean;
}

export function storeId(file: string, name: string): string {
  return `${file}#${name}`;
}

/** Local names bound to zustand's `create` / `createStore` in this file. */
function zustandCreateNames(imports: FileImports): Set<string> {
  const names = new Set<string>();
  for (const b of imports.bindings) {
    if (b.imported === 'create' || b.imported === 'createStore') {
      names.add(b.local);
    }
  }
  return names;
}

/** Extract the top-level property names from a store factory's return object. */
function stateKeysFromFactory(arg: Node): string[] {
  let objectLiteral: Node | undefined;

  if (Node.isArrowFunction(arg) || Node.isFunctionExpression(arg)) {
    const body = arg.getBody();
    if (Node.isParenthesizedExpression(body)) {
      const inner = body.getExpression();
      if (Node.isObjectLiteralExpression(inner)) objectLiteral = inner;
    } else if (Node.isObjectLiteralExpression(body)) {
      objectLiteral = body;
    } else if (Node.isBlock(body)) {
      // Find the first top-level `return { ... }`.
      for (const stmt of body.getStatements()) {
        if (Node.isReturnStatement(stmt)) {
          const expr = stmt.getExpression();
          if (expr && Node.isObjectLiteralExpression(expr)) {
            objectLiteral = expr;
            break;
          }
          if (expr && Node.isParenthesizedExpression(expr)) {
            const inner = expr.getExpression();
            if (Node.isObjectLiteralExpression(inner)) {
              objectLiteral = inner;
              break;
            }
          }
        }
      }
    }
  } else if (Node.isObjectLiteralExpression(arg)) {
    objectLiteral = arg;
  }

  if (!objectLiteral || !Node.isObjectLiteralExpression(objectLiteral)) {
    return [];
  }

  const keys: string[] = [];
  for (const prop of objectLiteral.getProperties()) {
    if (Node.isPropertyAssignment(prop) || Node.isMethodDeclaration(prop)) {
      keys.push(prop.getName());
    } else if (Node.isShorthandPropertyAssignment(prop)) {
      keys.push(prop.getName());
    }
  }
  return keys;
}

export function extractState(
  sourceFile: SourceFile,
  fileRel: string,
  imports: FileImports,
): StateFindings {
  const createNames = zustandCreateNames(imports);
  const usesContext = imports.bindings.some(
    (b) => b.imported === 'createContext' || b.imported === 'useContext',
  );

  const zustandStores: StoreDefinition[] = [];

  for (const decl of sourceFile.getVariableDeclarations()) {
    const statement = decl.getVariableStatement();
    if (!statement || statement.getParent() !== sourceFile) continue;
    const init = decl.getInitializer();
    if (!init || !Node.isCallExpression(init)) continue;

    // Unwrap curried middleware: create(devtools(persist(fn))) — the store
    // factory is the innermost function argument.
    let callee = init.getExpression();
    if (!Node.isIdentifier(callee)) continue;
    if (!createNames.has(callee.getText())) continue;

    const firstArg = init.getArguments()[0];
    if (!firstArg) continue;

    // If the argument is itself a call (middleware), dig for the factory fn.
    let factory: Node = firstArg;
    if (Node.isCallExpression(firstArg)) {
      const inner = firstArg.getDescendantsOfKind(SyntaxKind.ArrowFunction)[0];
      if (inner) factory = inner;
    }

    zustandStores.push({
      name: decl.getName(),
      file: fileRel,
      stateKeys: stateKeysFromFactory(factory),
    });
  }

  return {
    zustandStores,
    usesZustand: createNames.size > 0 || zustandStores.length > 0,
    usesContext,
  };
}
