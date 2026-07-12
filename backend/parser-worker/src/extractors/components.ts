/**
 * Component extraction.
 *
 * A component is a module-scope, PascalCase function-like definition whose body
 * contains JSX. For each we extract props, hooks used, child components, host
 * JSX element counts, event handlers, and styling.
 */

import { Node, SyntaxKind, type SourceFile } from 'ts-morph';
import {
  containsJsx,
  isHookName,
  isPascalCase,
  topLevelFunctions,
  type FunctionLike,
} from '../util';
import { extractStyling } from './styling';
import {
  extractImages,
  extractInlineStyles,
  extractLayoutHints,
  extractTextNodes,
} from './conversion';
import type { FileImports } from './imports';
import type { Component, PropInfo } from '../types';

export function componentId(file: string, name: string): string {
  return `${file}#${name}`;
}

function extractProps(fn: FunctionLike, sourceFile: SourceFile): PropInfo[] {
  const param = fn.getParameters()[0];
  if (!param) return [];

  const props: PropInfo[] = [];
  const seen = new Set<string>();
  const add = (name: string, type: string | null, optional: boolean) => {
    if (seen.has(name)) return;
    seen.add(name);
    props.push({ name, type, optional });
  };

  // 1. Prefer a named type/interface annotation defined in the same file.
  const typeNode = param.getTypeNode();
  if (typeNode && Node.isTypeReference(typeNode)) {
    const typeName = typeNode.getTypeName().getText();
    const iface = sourceFile.getInterface(typeName);
    if (iface) {
      for (const p of iface.getProperties()) {
        add(
          p.getName(),
          p.getTypeNode()?.getText() ?? null,
          p.hasQuestionToken(),
        );
      }
      return props;
    }
    const alias = sourceFile.getTypeAlias(typeName);
    const aliasType = alias?.getTypeNode();
    if (aliasType && Node.isTypeLiteral(aliasType)) {
      for (const p of aliasType.getProperties()) {
        add(
          p.getName(),
          p.getTypeNode()?.getText() ?? null,
          p.hasQuestionToken(),
        );
      }
      return props;
    }
  }

  // 2. Fall back to the destructured binding pattern (types unknown).
  const nameNode = param.getNameNode();
  if (Node.isObjectBindingPattern(nameNode)) {
    for (const element of nameNode.getElements()) {
      const propName = element.getPropertyNameNode()?.getText();
      const bindingName = element.getName();
      const rest = element.getDotDotDotToken() !== undefined;
      if (rest) continue; // ...props — not an enumerable named prop
      add(propName ?? bindingName, null, element.hasInitializer());
    }
  }

  return props;
}

function extractHooksUsed(fn: FunctionLike): string[] {
  const names = new Set<string>();
  for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (Node.isIdentifier(expr) && isHookName(expr.getText())) {
      names.add(expr.getText());
    }
  }
  return [...names].sort();
}

interface JsxUsage {
  jsxElements: Record<string, number>;
  childComponents: string[];
  eventHandlers: string[];
}

function extractJsxUsage(fn: FunctionLike): JsxUsage {
  const jsxElements: Record<string, number> = {};
  const childComponents = new Set<string>();
  const eventHandlers = new Set<string>();

  const tagNodes = [
    ...fn.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...fn.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
  for (const tag of tagNodes) {
    const tagName = tag.getTagNameNode().getText();
    const first = tagName[0] ?? '';
    if (first === first.toUpperCase() && /[A-Za-z]/.test(first)) {
      childComponents.add(tagName);
    } else {
      jsxElements[tagName] = (jsxElements[tagName] ?? 0) + 1;
    }
  }

  for (const attr of fn.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    const name = attr.getNameNode().getText();
    if (/^on[A-Z]/.test(name)) eventHandlers.add(name);
  }

  return {
    jsxElements,
    childComponents: [...childComponents].sort(),
    eventHandlers: [...eventHandlers].sort(),
  };
}

// Browser globals with no React Native equivalent. Detected so the Analyzer can
// flag WEB_API_USAGE from a KG fact (parsing stays in Node, never in Python).
const WEB_GLOBALS = new Set([
  'localStorage',
  'sessionStorage',
  'document',
  'window',
  'navigator',
  'location',
  'history',
  'alert',
  'confirm',
  'prompt',
  'matchMedia',
  'requestAnimationFrame',
  'cancelAnimationFrame',
]);

/** Collect browser-global references used inside a component body. */
function extractWebApis(fn: FunctionLike): string[] {
  const found = new Set<string>();
  for (const id of fn.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const text = id.getText();
    if (!WEB_GLOBALS.has(text)) continue;

    // Skip when the identifier is a property name (`foo.window`), an object
    // property key, or a locally declared/imported binding that shadows it.
    const parent = id.getParent();
    if (
      Node.isPropertyAccessExpression(parent) &&
      parent.getNameNode() === id
    ) {
      continue;
    }
    if (
      Node.isPropertyAssignment(parent) &&
      parent.getNameNode() === id
    ) {
      continue;
    }
    found.add(text);
  }
  return [...found].sort();
}

export function extractComponents(
  sourceFile: SourceFile,
  fileRel: string,
  imports: FileImports,
): Component[] {
  const components: Component[] = [];

  for (const { name, fn, isDefaultExport } of topLevelFunctions(sourceFile)) {
    if (!isPascalCase(name)) continue;
    if (!containsJsx(fn)) continue;

    const styling = extractStyling(fn, imports);
    const usage = extractJsxUsage(fn);

    components.push({
      id: componentId(fileRel, name),
      name,
      file: fileRel,
      exportType: isDefaultExport ? 'default' : 'named',
      props: extractProps(fn, sourceFile),
      hooksUsed: extractHooksUsed(fn),
      childComponents: usage.childComponents,
      jsxElements: usage.jsxElements,
      eventHandlers: usage.eventHandlers,
      stylingApproach: styling.stylingApproach,
      tailwindClasses: styling.tailwindClasses,
      cssModuleImports: styling.cssModuleImports,
      webApis: extractWebApis(fn),
      textNodes: extractTextNodes(fn),
      layoutHints: extractLayoutHints(fn),
      images: extractImages(fn, imports),
      inlineStyles: extractInlineStyles(fn),
    });
  }

  return components;
}
