#!/usr/bin/env node
/**
 * Rejox codemod-worker CLI.
 *
 *   node dist/index.js <sourceFile> [optionsJson]
 *
 * Reads the React source file, applies the deterministic transforms, and prints
 * the ConvertResult as JSON to stdout. Diagnostics go to stderr. The output is
 * self-checked for syntactic validity before being emitted.
 */

import * as fs from 'fs';
import * as path from 'path';
import { convert, syntacticErrorCount } from './convert';
import type { Options } from './types';

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function main(): void {
  const filePath = process.argv[2];
  if (!filePath) fail('Usage: node dist/index.js <sourceFile> [optionsJson]');

  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) fail(`File not found: ${abs}`);

  let options: Options = {};
  const raw = process.argv[3];
  if (raw) {
    try {
      options = JSON.parse(raw) as Options;
    } catch (err) {
      fail(`Invalid options JSON: ${(err as Error).message}`);
    }
  }

  const source = fs.readFileSync(abs, 'utf8');
  const result = convert(filePath, source, options);

  const errors = syntacticErrorCount(result.code);
  if (errors > 0) {
    // Contract violation: never emit invalid TS. Surface loudly.
    fail(
      `codemod produced ${errors} syntactic error(s) for ${filePath}; refusing to emit.`,
    );
  }

  process.stdout.write(JSON.stringify(result));
}

try {
  main();
} catch (err) {
  fail(`codemod-worker crashed: ${(err as Error).stack ?? String(err)}`);
}
