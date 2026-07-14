#!/usr/bin/env node
/**
 * CSS-Module component rewrite (Node side of the CSS Module resolver).
 *
 *   node dist/cssmodule.js <componentFile> <moduleSpecifier> <styleBodyFile>
 *
 * Given a component that did `import styles from './X.module.css'`, and the RN
 * StyleSheet object body Python generated from that CSS, rewrite the component
 * with ts-morph (never regex on JSX):
 *
 *   1. drop the `.module.css` import;
 *   2. inline `const <name> = StyleSheet.create(<body>)` under the imports,
 *      reusing the SAME local name the default import used, so every
 *      `styles.card` reference keeps working unchanged;
 *   3. ensure `import { StyleSheet } from 'react-native'`;
 *   4. flip `className={styles.X}` → `style={styles.X}` — the only reference
 *      change RN needs (StyleSheet objects are passed to `style`, not `className`).
 *
 * Prints the rewritten component source to stdout.
 */

import * as fs from 'fs';
import * as path from 'path';
import { IndentationText, Node, Project, QuoteKind, SyntaxKind } from 'ts-morph';

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function main(): void {
  const [, , componentFile, moduleSpecifier, styleBodyFile] = process.argv;
  if (!componentFile || !moduleSpecifier || !styleBodyFile) {
    fail('Usage: node dist/cssmodule.js <componentFile> <moduleSpecifier> <styleBodyFile>');
  }
  const absComp = path.resolve(componentFile);
  if (!fs.existsSync(absComp)) fail(`File not found: ${absComp}`);
  const source = fs.readFileSync(absComp, 'utf8');
  const styleBody = fs.readFileSync(path.resolve(styleBodyFile), 'utf8').trim();

  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: 4 /* react-jsx */, allowJs: true },
    manipulationSettings: {
      indentationText: IndentationText.TwoSpaces,
      quoteKind: QuoteKind.Single,
    },
  });
  const sf = project.createSourceFile('input.tsx', source, { overwrite: true });

  // 1. locate + drop the CSS-module import; remember its local (default) name.
  const cssImport = sf
    .getImportDeclarations()
    .find((d) => d.getModuleSpecifierValue() === moduleSpecifier);
  if (!cssImport) fail(`No import of '${moduleSpecifier}' found in ${componentFile}`);
  const stylesName = cssImport.getDefaultImport()?.getText() ?? 'styles';
  const insertPos = cssImport.getEnd();
  cssImport.replaceWithText(`const ${stylesName} = StyleSheet.create(${styleBody});`);

  // 3. ensure StyleSheet is imported from react-native.
  const rnImport = sf
    .getImportDeclarations()
    .find((d) => d.getModuleSpecifierValue() === 'react-native');
  if (rnImport) {
    if (!rnImport.getNamedImports().some((n) => n.getName() === 'StyleSheet')) {
      rnImport.addNamedImport('StyleSheet');
    }
  } else {
    sf.insertImportDeclaration(0, {
      moduleSpecifier: 'react-native',
      namedImports: ['StyleSheet'],
    });
  }

  // 4. flip className={<stylesName>.X} → style={...}. If the element ALREADY has
  //    a `style` prop (e.g. an injected image size), MERGE into a style array —
  //    two `style`/duplicate attributes are a TS error.
  for (const attr of sf.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    if (attr.getNameNode().getText() !== 'className') continue;
    const init = attr.getInitializer();
    if (!init || !Node.isJsxExpression(init)) continue;
    const expr = init.getExpression();
    if (!expr) continue;
    // Match `styles.card` (property access whose object is the styles identifier).
    if (
      !Node.isPropertyAccessExpression(expr) ||
      expr.getExpression().getText() !== stylesName
    ) {
      continue;
    }
    const styleRef = expr.getText();
    const opening = attr.getFirstAncestorByKind(SyntaxKind.JsxOpeningElement)
      ?? attr.getFirstAncestorByKind(SyntaxKind.JsxSelfClosingElement);
    const existingStyle = opening
      ?.getAttributes()
      .find((a) => Node.isJsxAttribute(a) && a.getNameNode().getText() === 'style');
    if (existingStyle && Node.isJsxAttribute(existingStyle)) {
      const styleInit = existingStyle.getInitializer();
      const prev =
        styleInit && Node.isJsxExpression(styleInit)
          ? styleInit.getExpression()?.getText() ?? ''
          : '';
      // RN merges via an array; the CSS-module style wins by coming first.
      existingStyle.setInitializer(`{[${styleRef}, ${prev}]}`);
      attr.remove();
    } else {
      attr.getNameNode().replaceWithText('style');
    }
  }

  void insertPos;
  sf.formatText();
  process.stdout.write(sf.getFullText());
}

try {
  main();
} catch (err) {
  fail(`cssmodule-worker crashed: ${(err as Error).stack ?? String(err)}`);
}
