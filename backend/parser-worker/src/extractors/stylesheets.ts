/**
 * Class selectors a project defines in its OWN stylesheets.
 *
 * NativeWind resolves Tailwind utilities and nothing else. A `className` naming
 * a class the project declared itself — `.app`, `.black_btn`, the `@apply`
 * compositions almost every Tailwind codebase grows — is silently ignored at
 * runtime: no error, no warning, just an element that renders unstyled.
 *
 * Counting those as mapped Tailwind classes is doubly wrong: it inflates
 * Coverage, and it hides that the app lost its design. Telling them apart needs
 * one fact only the project can supply — which classes it defines — so it is
 * read here, from the stylesheets themselves, rather than guessed from the
 * shape of a name.
 *
 * CSS Modules are deliberately excluded: their classes are reached through the
 * imported `styles` object, not as bare className strings, and the CSS Module
 * resolver already re-expresses them.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Stylesheet } from '../types';

/**
 * Every position where a selector can appear: the text between one brace and
 * the `{` that opens the next block. Matching selector POSITIONS rather than
 * dots anywhere in the file is what keeps `url("…/grid.svg")` and `0.75rem`
 * out of the results.
 */
const SELECTOR_RE = /(?:^|[{}])([^{}]*)\{/g;

/** A class selector: `.black_btn`, `.link_card`, `.-mt-1`. */
const CLASS_RE = /\.(-?[_a-zA-Z][\w-]*)/g;

/** A CSS Module — reached through `styles.x`, never as a bare className. */
export function isCssModule(rel: string): boolean {
  return /\.module\.(css|scss|sass|less)$/.test(rel);
}

/** Class names declared by ``css``, deduplicated and sorted. */
export function definedClasses(css: string): string[] {
  // Comments first: a commented-out rule declares nothing.
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = new Set<string>();
  for (const match of text.matchAll(SELECTOR_RE)) {
    // A statement-form at-rule (`@tailwind base;`, `@import "…";`) sits in the
    // same run of text as the selector that follows it, so the selector starts
    // after the last `;` — without this, one `@tailwind` line at the top of a
    // file hides every rule under it.
    const raw = match[1];
    const selector = raw.slice(raw.lastIndexOf(';') + 1);
    // A block at-rule's prelude (`@media screen and …`) is not a selector. The
    // rules nested inside it are matched separately, by their own `{`.
    if (selector.trimStart().startsWith('@')) continue;
    for (const cls of selector.matchAll(CLASS_RE)) found.add(cls[1]);
  }
  return [...found].sort();
}

/** Read the project's non-module stylesheets and record what each declares. */
export function extractStylesheets(root: string, styleFiles: string[]): Stylesheet[] {
  const sheets: Stylesheet[] = [];
  for (const rel of styleFiles) {
    if (isCssModule(rel)) continue;
    let text: string;
    try {
      text = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch {
      continue; // unreadable is not a declaration; the file list still shows it
    }
    const classes = definedClasses(text);
    if (classes.length > 0) sheets.push({ file: rel, classes });
  }
  return sheets.sort((a, b) => a.file.localeCompare(b.file));
}
