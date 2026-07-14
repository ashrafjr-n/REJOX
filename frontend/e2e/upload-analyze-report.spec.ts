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

interface PlanStepLite {
  id: string
  dependsOn?: string[]
}

/** Same longest-path layering the app uses — the expected wave count. */
function waveCount(steps: PlanStepLite[]): number {
  const byId = new Map(steps.map((s) => [s.id, s]))
  const memo = new Map<string, number>()
  const depth = (id: string): number => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    const s = byId.get(id)
    const deps = (s?.dependsOn ?? []).filter((d) => byId.has(d))
    const w = !s || deps.length === 0 ? 0 : 1 + Math.max(...deps.map(depth))
    memo.set(id, w)
    return w
  }
  const maxW = steps.length ? Math.max(...steps.map((s) => depth(s.id))) : -1
  return maxW + 1
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

  // --- 4 · Plan screen — the real DAG from /api/plan -----------------------
  const planResponse = page.waitForResponse(
    (r) => r.url().includes('/api/plan') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: /Plan the migration/i }).click()
  const planJson = (await (await planResponse).json()) as {
    plan: { steps: PlanStepLite[]; questions: { id: string }[] }
  }
  const steps = planJson.plan.steps
  const questions = planJson.plan.questions
  const expectedWaves = waveCount(steps)

  // Wait for the DAG to render every step as a node.
  await expect(page.getByTestId('plan-node')).toHaveCount(steps.length, {
    timeout: 30_000,
  })
  // Node count and wave count must equal what /api/plan actually returned.
  expect(await page.getByTestId('plan-node').count()).toBe(steps.length)
  expect(await page.getByTestId('plan-wave').count()).toBe(expectedWaves)

  // A node with a real finding must render distinctly (flagged).
  expect(await page.locator('[data-testid="plan-node"][data-flagged="true"]').count())
    .toBeGreaterThan(0)

  await page.screenshot({ path: path.join(SHOTS, '05-plan.png'), fullPage: true })

  // --- 5 · Ask screen — the real questions ---------------------------------
  await page.getByRole('button', { name: /Continue to decisions|Continue/i }).click()
  await expect(page.getByTestId('ask-question')).toHaveCount(questions.length)
  await page.screenshot({ path: path.join(SHOTS, '06-ask.png'), fullPage: true })

  // --- 6 · Submit answers to the real /api/migrate -------------------------
  const migrateResponse = page.waitForResponse(
    (r) => r.url().includes('/api/migrate') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: /Start migration/i }).click()
  const migrate = await migrateResponse
  expect(migrate.status(), 'migrate accepted the answers (202)').toBe(202)
  expect((await migrate.json()).jobId, 'migrate returned a jobId').toBeTruthy()
  await expect(page.getByTestId('submitted')).toBeVisible()

  // eslint-disable-next-line no-console
  console.log(
    `[e2e] plan: ${steps.length} nodes, ${expectedWaves} waves; ` +
      `ask: ${questions.length} questions; migration started`,
  )
})
