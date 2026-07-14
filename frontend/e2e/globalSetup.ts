import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))

/**
 * Build the upload fixture: a clean ZIP of test-projects/sample-app with
 * node_modules / dist / .git excluded (source only — the real thing a user
 * would upload). Regenerated every run so it never goes stale.
 */
export default function globalSetup() {
  const fixtures = path.join(dir, 'fixtures')
  fs.mkdirSync(fixtures, { recursive: true })

  const zipPath = path.join(fixtures, 'sample-app.zip')
  fs.rmSync(zipPath, { force: true })

  const sampleApp = path.resolve(dir, '../../test-projects/sample-app')
  execFileSync(
    'zip',
    [
      '-rq',
      zipPath,
      '.',
      '-x',
      '*/node_modules/*',
      'node_modules/*',
      '*/dist/*',
      'dist/*',
      '.git/*',
    ],
    { cwd: sampleApp },
  )
}
