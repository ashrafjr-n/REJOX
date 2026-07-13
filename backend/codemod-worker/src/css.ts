#!/usr/bin/env node
/**
 * CSS-Module parser (Node side of the CSS Module resolver).
 *
 *   node dist/css.js <cssFile>
 *
 * Parsing stays in Node — with a *real* CSS parser (postcss), never a regex —
 * exactly as the architecture requires parsing to live in the worker. This
 * entry does ONE thing: turn a `.module.css` file into a structured JSON AST
 * that Python's declarative CSS→RN table maps deterministically. It makes no
 * mapping decisions itself.
 *
 * Output (stdout):
 *   {
 *     "rules": [
 *       { "selector": ".card", "className": "card", "pseudo": null,
 *         "decls": [ { "prop": "display", "value": "flex" }, ... ] },
 *       { "selector": ".card:hover", "className": "card", "pseudo": "hover",
 *         "decls": [ ... ] }
 *     ],
 *     "unsupportedSelectors": [ ".card .thumb", ... ]   // non-simple selectors
 *   }
 */

import * as fs from 'fs';
import * as path from 'path';
import postcss from 'postcss';

interface Decl {
  prop: string;
  value: string;
}
interface Rule {
  selector: string;
  className: string;
  pseudo: string | null;
  decls: Decl[];
}
interface ParsedCss {
  rules: Rule[];
  unsupportedSelectors: string[];
}

// A single class selector, optionally with ONE pseudo-class: `.card`, `.card:hover`.
const SIMPLE_SELECTOR = /^\.([A-Za-z_][\w-]*)(?::([A-Za-z-]+))?$/;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseCss(css: string): ParsedCss {
  const root = postcss.parse(css);
  const rules: Rule[] = [];
  const unsupportedSelectors: string[] = [];

  root.walkRules((rule) => {
    // A rule may carry a comma-separated selector list; classify each.
    for (const selector of rule.selectors) {
      const m = SIMPLE_SELECTOR.exec(selector.trim());
      if (!m) {
        unsupportedSelectors.push(selector.trim());
        continue;
      }
      const decls: Decl[] = [];
      rule.walkDecls((decl) => {
        decls.push({ prop: decl.prop.toLowerCase(), value: decl.value.trim() });
      });
      rules.push({
        selector: selector.trim(),
        className: m[1],
        pseudo: m[2] ?? null,
        decls,
      });
    }
  });

  return { rules, unsupportedSelectors };
}

function main(): void {
  const file = process.argv[2];
  if (!file) fail('Usage: node dist/css.js <cssFile>');
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) fail(`File not found: ${abs}`);
  const css = fs.readFileSync(abs, 'utf8');
  process.stdout.write(JSON.stringify(parseCss(css)));
}

try {
  main();
} catch (err) {
  fail(`css-worker crashed: ${(err as Error).stack ?? String(err)}`);
}
