import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const dir = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.resolve(dir, '../../docs/screenshots')
const ZIP = path.join(dir, 'fixtures', 'sample-app.zip')

/** Mirror the frontend's formatScore() so on-screen text can be asserted. */
function formatScore(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

const RISK_LABEL: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

interface ScoreContribution {
  delta: number
}
interface AnalyzeResponse {
  coverage: number
  confidence: number
  risk: string
  contributions: ScoreContribution[]
}

test('Upload → Analyze → Report against the real backend', async ({ page }) => {
  fs.mkdirSync(SHOTS, { recursive: true })

  // --- 1 · Upload screen ---------------------------------------------------
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: /Hand Rejox a React codebase/i }),
  ).toBeVisible()
  await page.screenshot({ path: path.join(SHOTS, '01-upload.png'), fullPage: true })

  // Upload the sample app ZIP via the (hidden) file input.
  const uploadResponse = page.waitForResponse(
    (r) => r.url().includes('/api/upload') && r.request().method() === 'POST',
  )
  await page.locator('input[type=file]').setInputFiles(ZIP)
  const upload = await (await uploadResponse).json()
  expect(upload.runId, 'upload returned a runId').toBeTruthy()

  // --- 2 · Landed → kick off analysis --------------------------------------
  await expect(page.getByText('React project detected')).toBeVisible()

  const analyzeResponse = page.waitForResponse(
    (r) => r.url().includes('/api/analyze') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: /Analyze project/i }).click()

  // The Analyzing screen renders synchronously on click; capture it while the
  // request is still in flight (the honest indeterminate state).
  await expect(page.getByTestId('analyzing-screen')).toBeVisible()
  await page.screenshot({ path: path.join(SHOTS, '02-analyzing.png'), fullPage: true })

  // The canonical numbers: the live /api/analyze response for THIS run.
  const report = (await (await analyzeResponse).json()) as AnalyzeResponse

  // --- 3 · Report screen ---------------------------------------------------
  await expect(page.getByTestId('report-screen')).toBeVisible({ timeout: 30_000 })
  // Let the count-up settle before asserting/screenshotting the final figures.
  await expect(page.getByTestId('metric-coverage')).toHaveText(
    formatScore(report.coverage),
    { timeout: 5_000 },
  )
  await page.screenshot({ path: path.join(SHOTS, '03-report.png'), fullPage: true })

  // --- Acceptance: on-screen numbers == live backend response --------------
  await expect(page.getByTestId('metric-coverage')).toHaveText(formatScore(report.coverage))
  await expect(page.getByTestId('metric-confidence')).toHaveText(formatScore(report.confidence))
  await expect(page.getByTestId('metric-risk')).toHaveText(RISK_LABEL[report.risk])
  await expect(page.getByTestId('coverage-total')).toHaveText(formatScore(report.coverage))

  // The ScoreContribution deltas must sum to Coverage (the product's contract).
  const sum = report.contributions.reduce((acc, c) => acc + c.delta, 0)
  expect(Math.abs(sum - report.coverage)).toBeLessThan(0.01)

  // eslint-disable-next-line no-console
  console.log(
    `[e2e] asserted on-screen == live: coverage=${report.coverage} ` +
      `confidence=${report.confidence} risk=${report.risk} Σcontrib=${sum.toFixed(2)}`,
  )
})
