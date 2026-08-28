import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const dir = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.resolve(dir, '../../docs/screenshots')
const ZIP = path.join(dir, 'fixtures', 'sample-app.zip')
const API = 'http://localhost:8000'

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
  wave: number
}

/** Distinct wave count, sourced straight from the backend's step.wave. */
function waveCount(steps: PlanStepLite[]): number {
  return new Set(steps.map((s) => s.wave)).size
}

test('Upload → Analyze → Report against the real backend', async ({ page }) => {
  test.setTimeout(300_000) // the full path includes a real ~2-min migration
  fs.mkdirSync(SHOTS, { recursive: true })

  // --- 1 · Upload screen ---------------------------------------------------
  await page.goto('/app')
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

  // --- 6 · Submit → the migration job starts -------------------------------
  const migrateResponse = page.waitForResponse(
    (r) => r.url().includes('/api/migrate') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: /Start migration/i }).click()
  const migrate = await migrateResponse
  expect(migrate.status(), 'migrate accepted the answers (202)').toBe(202)
  const jobId = (await migrate.json()).jobId as string
  expect(jobId, 'migrate returned a jobId').toBeTruthy()

  // --- 7 · Migrate screen streams real events ------------------------------
  await expect(page.getByTestId('migrate-screen')).toBeVisible()
  // Capture the live streaming state (a stage in flight — no terminal yet).
  await expect(page.getByTestId('stage-emit')).toHaveAttribute('data-state', 'done', {
    timeout: 60_000,
  })
  await page.screenshot({ path: path.join(SHOTS, '07-migrating.png'), fullPage: true })

  // --- 8 · Terminal: validated result + download ---------------------------
  await expect(page.getByTestId('migrate-result')).toBeVisible({ timeout: 220_000 })

  // The canonical numbers: the job's own MigrationResult (source of truth).
  const job = await (await page.request.get(`${API}/api/jobs/${jobId}`)).json()
  const result = job.result
  expect(result, 'job finished with a result').toBeTruthy()

  // On-screen verdicts equal the backend's.
  await expect(page.getByTestId('migrate-tsc')).toHaveText(
    result.typecheckPassed ? 'tsc PASS' : 'tsc FAIL',
  )
  await expect(page.getByTestId('migrate-metro')).toHaveText(
    result.bundlePassed ? 'Metro PASS' : /Metro/,
  )
  expect(result.typecheckPassed, 'tsc passed').toBe(true)
  expect(result.bundlePassed, 'Metro passed').toBe(true)

  // The thesis: exactly one LLM call, shown on screen == the result.
  expect(result.llmCalls).toBe(1)
  await expect(page.getByTestId('migrate-llm-calls')).toHaveText(String(result.llmCalls))

  // Validated numbers on screen equal the terminal MigrationResult.
  const fmt = (v: number) => {
    const r = Math.round(v * 10) / 10
    return Number.isInteger(r) ? String(r) : r.toFixed(1)
  }
  // The validated headline is the STRICT lens; the forgiving compiles-and-bundles
  // figure is shown beside it, labelled, never in its place.
  await expect(page.getByTestId('validated-coverage')).toHaveText(
    fmt(result.validatedScores.coverage),
  )
  await expect(page.getByTestId('validated-compiling-coverage')).toHaveText(
    `${fmt(result.validatedScores.workingCoverage)}%`,
  )
  await expect(page.getByTestId('validated-confidence')).toHaveText(
    fmt(result.validatedScores.confidence),
  )

  // Predicted and validated are shown as SEPARATE values (two distinct axes).
  const predictedCov = await page.getByTestId('predicted-coverage').textContent()
  const validatedCov = await page.getByTestId('validated-coverage').textContent()
  expect(predictedCov).not.toBeNull()
  expect(predictedCov).not.toBe(validatedCov) // sample-app: 82.x predicted vs 58 strict

  await page.screenshot({ path: path.join(SHOTS, '08-validated.png'), fullPage: true })

  // --- 9 · Download returns a real file ------------------------------------
  const href = await page.getByTestId('download-button').getAttribute('href')
  expect(href).toContain(`/api/runs/${result.runId}/download`)
  const dl = await page.request.get(href!)
  expect(dl.status()).toBe(200)
  expect(dl.headers()['content-type']).toContain('zip')
  expect((await dl.body()).length).toBeGreaterThan(0)

  // eslint-disable-next-line no-console
  console.log(
    `[e2e] plan ${steps.length}/${expectedWaves}; ask ${questions.length}; ` +
      `migrate tsc=${result.typecheckPassed} metro=${result.bundlePassed} ` +
      `llm=${result.llmCalls} strictCov=${result.validatedScores.coverage} ` +
      `predictedCov=${report.coverage}`,
  )
})
