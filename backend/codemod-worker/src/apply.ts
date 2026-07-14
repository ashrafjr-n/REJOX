#!/usr/bin/env node
/**
 * Apply AI-Resolution-Engine styling/NAV_ACTIVE resolutions to a component.
 *
 *   node dist/apply.js <componentFile> <planFile>
 *
 * The Python resolvers decide WHAT each residue becomes; this codemod applies it
 * to the file with ts-morph (never regex on JSX). The plan is JSON:
 *
 *   {
 *     "classMap": { "hover:bg-slate-100": ["active:bg-slate-100"],
 *                   "transition-colors": [], "grid": ["flex-row","flex-wrap"], … },
 *     "navActive": true
 *   }
 *
 * Two passes:
 *   1. NAV_ACTIVE — a `className={({ isActive }) => `…${isActive ? A : B}`}`
 *      render-prop (invalid on an RN Pressable) becomes a static className string
 *      (the inactive branch; the navigator owns active state).
 *   2. classMap — every *class-shaped* string literal (className attrs AND the
 *      class strings held in variables, e.g. a Button's `variants`) has its
 *      residue tokens replaced or dropped. Supported tokens pass through; a
 *      string with no residue token is never touched.
 *
 * Prints the rewritten source to stdout.
 */

import * as fs from 'fs';
import * as path from 'path';
import { IndentationText, Node, Project, QuoteKind, SyntaxKind } from 'ts-morph';

interface Plan {
  classMap: Record<string, string[]>;
  navActive: boolean;
}

// A token that looks like a utility class (lowercase-ish, no prose).
const CLASS_TOKEN = /^[a-z0-9[][\w:/.\-[\]%#]*$/;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** Static className text from a NavLink-style function className body. */
function staticFromTemplate(node: Node): string | null {
  if (Node.isNoSubstitutionTemplateLiteral(node) || Node.isStringLiteral(node)) {
    return node.getLiteralText();
  }
  if (!Node.isTemplateExpression(node)) return null;
  let out = node.getHead().getLiteralText();
  for (const span of node.getTemplateSpans()) {
    const expr = span.getExpression();
    // `cond ? A : B` → keep the inactive (false) branch when it is a literal.
    if (Node.isConditionalExpression(expr)) {
      const whenFalse = expr.getWhenFalse();
      if (Node.isStringLiteral(whenFalse)) out += whenFalse.getLiteralText();
    }
    out += span.getLiteral().getLiteralText();
  }
  return out;
}

function returnedExpression(fn: Node): Node | undefined {
  if (Node.isArrowFunction(fn)) {
    const body = fn.getBody();
    if (!Node.isBlock(body)) return body;
    const ret = body.getStatements().find(Node.isReturnStatement);
    return ret?.getExpression();
  }
  if (Node.isFunctionExpression(fn)) {
    const body = fn.getBody();
    if (!body || !Node.isBlock(body)) return undefined;
    const ret = body.getStatements().find(Node.isReturnStatement);
    return ret?.getExpression();
  }
  return undefined;
}

/** Pass 1: static-ize `className={(…) => `…`}` render-props. */
function staticizeNavActive(sf: import('ts-morph').SourceFile): void {
  for (const attr of sf.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    if (attr.getNameNode().getText() !== 'className') continue;
    const init = attr.getInitializer();
    if (!init || !Node.isJsxExpression(init)) continue;
    const expr = init.getExpression();
    if (!expr || (!Node.isArrowFunction(expr) && !Node.isFunctionExpression(expr))) continue;
    const returned = returnedExpression(expr);
    if (!returned) continue;
    const staticText = staticFromTemplate(returned);
    if (staticText === null) continue;
    attr.setInitializer(JSON.stringify(staticText.trim()));
  }
}

/** Rewrite one whitespace-joined class string via the classMap. Returns null
 *  when the string is not class-shaped or carries no residue token. */
function rewriteClassString(text: string, classMap: Record<string, string[]>): string | null {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (!tokens.some((t) => t in classMap)) return null; // no residue → leave it
  if (!tokens.every((t) => CLASS_TOKEN.test(t))) return null; // not a class list → safety
  const out: string[] = [];
  for (const t of tokens) {
    const repl = t in classMap ? classMap[t] : [t];
    for (const r of repl) if (r && !out.includes(r)) out.push(r);
  }
  return out.join(' ');
}

/** Pass 2: rewrite residue tokens in every class-shaped string literal. */
function applyClassMap(sf: import('ts-morph').SourceFile, classMap: Record<string, string[]>): void {
  if (Object.keys(classMap).length === 0) return;
  const literals = [
    ...sf.getDescendantsOfKind(SyntaxKind.StringLiteral),
    ...sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
  ];
  for (const lit of literals) {
    const rewritten = rewriteClassString(lit.getLiteralText(), classMap);
    if (rewritten === null || rewritten === lit.getLiteralText()) continue;
    if (Node.isStringLiteral(lit)) {
      lit.setLiteralValue(rewritten);
    } else {
      lit.replaceWithText(`\`${rewritten}\``);
    }
  }
}

function main(): void {
  const [, , componentFile, planFile] = process.argv;
  if (!componentFile || !planFile) fail('Usage: node dist/apply.js <componentFile> <planFile>');
  const absComp = path.resolve(componentFile);
  if (!fs.existsSync(absComp)) fail(`File not found: ${absComp}`);
  const plan = JSON.parse(fs.readFileSync(path.resolve(planFile), 'utf8')) as Plan;

  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: 4 /* react-jsx */, allowJs: true },
    manipulationSettings: {
      indentationText: IndentationText.TwoSpaces,
      quoteKind: QuoteKind.Single,
    },
  });
  const sf = project.createSourceFile('input.tsx', fs.readFileSync(absComp, 'utf8'), { overwrite: true });

  if (plan.navActive) staticizeNavActive(sf);
  applyClassMap(sf, plan.classMap ?? {});

  sf.formatText();
  process.stdout.write(sf.getFullText());
}

try {
  main();
} catch (err) {
  fail(`apply-worker crashed: ${(err as Error).stack ?? String(err)}`);
}
