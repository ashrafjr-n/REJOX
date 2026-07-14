import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

import { expect, test } from '@playwright/test'

const dir = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.resolve(dir, '../../docs/screenshots')

/**
 * Task 2's contract: the header LED never claims a fact it hasn't verified.
 * With the backend reachable it reports "ready"; when /health fails it reports
 * a visibly distinct "unreachable". We prove both against the real poll.
 */
test('health LED reflects a real /health probe (ready + unreachable)', async ({
  page,
}) => {
  fs.mkdirSync(SHOTS, { recursive: true })

  // Backend is up (Playwright webServer) → the poll should reach "ready".
  await page.goto('/')
  await expect(page.getByText('engine ready')).toBeVisible({ timeout: 10_000 })

  // Now force /health to fail and reload: the poll must report "unreachable".
  await page.route('**/health', (route) => route.abort())
  await page.reload()
  await expect(page.getByText('engine unreachable')).toBeVisible({ timeout: 10_000 })
  await page.screenshot({
    path: path.join(SHOTS, '04-health-unreachable.png'),
    fullPage: false,
  })
})
