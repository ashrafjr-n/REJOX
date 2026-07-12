#!/usr/bin/env node
/**
 * Standalone syntactic validator.
 *
 *   node dist/check.js <file>
 *
 * Prints the number of TS/TSX syntactic errors in <file> to stdout. Used by the
 * tests to independently re-parse converted output and assert zero errors.
 */

import * as fs from 'fs';
import { syntacticErrorCount } from './convert';

const file = process.argv[2];
if (!file) {
  process.stderr.write('Usage: node dist/check.js <file>\n');
  process.exit(1);
}
const code = fs.readFileSync(file, 'utf8');
process.stdout.write(String(syntacticErrorCount(code)));
