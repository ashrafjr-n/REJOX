/**
 * File discovery.
 *
 * Recursively collects files under a project root, honouring .gitignore and
 * always skipping heavy / generated directories (node_modules, dist, build,
 * .git). Paths are returned relative to the root with POSIX separators so the
 * Knowledge Graph is stable across machines.
 */

import * as fs from 'fs';
import * as path from 'path';
import ignore, { type Ignore } from 'ignore';

const ALWAYS_SKIP = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.next',
  'coverage',
  '.turbo',
]);

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const STYLE_EXT = new Set(['.css', '.scss', '.sass', '.less']);
const ASSET_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
]);

export interface DiscoveredFiles {
  /** Parseable source files (.ts/.tsx/.js/.jsx). */
  source: string[];
  /** Stylesheet files (.css, .scss, ...). */
  style: string[];
  /** Static assets (images, fonts, ...). */
  asset: string[];
  /** Everything else that survived the ignore rules. */
  other: string[];
}

/** POSIX-normalise a path relative to root. */
export function toPosix(rel: string): string {
  return rel.split(path.sep).join('/');
}

function loadGitignore(root: string): Ignore {
  const ig = ignore();
  const gitignorePath = path.join(root, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    ig.add(fs.readFileSync(gitignorePath, 'utf8'));
  }
  return ig;
}

export function walk(root: string): DiscoveredFiles {
  const ig = loadGitignore(root);
  const result: DiscoveredFiles = {
    source: [],
    style: [],
    asset: [],
    other: [],
  };

  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = toPosix(path.relative(root, abs));
      if (!rel || rel.startsWith('..')) continue;

      if (entry.isDirectory()) {
        if (ALWAYS_SKIP.has(entry.name)) continue;
        // ignore package matches directories with a trailing check.
        if (ig.ignores(rel) || ig.ignores(`${rel}/`)) continue;
        visit(abs);
        continue;
      }

      if (!entry.isFile()) continue;
      if (ig.ignores(rel)) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (SOURCE_EXT.has(ext)) result.source.push(rel);
      else if (STYLE_EXT.has(ext)) result.style.push(rel);
      else if (ASSET_EXT.has(ext)) result.asset.push(rel);
      else result.other.push(rel);
    }
  };

  visit(root);

  result.source.sort();
  result.style.sort();
  result.asset.sort();
  result.other.sort();
  return result;
}
