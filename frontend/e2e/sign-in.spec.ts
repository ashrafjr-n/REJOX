import { expect, test } from '@playwright/test'

import { INVITE_CODE } from './session'

/**
 * The browser sign-in path, end to end, on a server that is NOT anonymous:
 * an invite code exchanged at /api/session for an httpOnly cookie the browser
 * then sends by itself on every request after it.
 *
 * backend/tests/test_sessions.py already proves the API's half of this with a
 * Python client. What only a real browser can prove is the half that fails
 * silently: the cookie is `SameSite=Lax`, so it is sent only while the app and
 * the API share ONE origin. Point VITE_API_URL at http://localhost:8000 while
 * the app is on :5173 and every API-level assertion still passes — POST
 * /api/session returns 200, the cookie is stored — and the app simply never
 * stays signed in. This project runs same-origin through the Vite proxy, the
 * shape production and dev-local.sh both use, so a change that breaks it fails
 * here instead of being found by hand.
 *
 * The `signin` project deliberately carries no stored session: each test below
 * starts in a browser that has never signed in.
 */

const GATE = /Enter your invite code/i
const PIPELINE = /Hand Rejox a React codebase/i

/** Guarded, and cheap: 401 when unauthenticated, 404 once a session is held. */
const GUARDED = '/api/jobs/deadbeef'

test('a browser with no session is gated, and the API refuses it', async ({ page }) => {
  await page.goto('/app')

  await expect(page.getByRole('heading', { name: GATE })).toBeVisible()
  await expect(page.getByRole('heading', { name: PIPELINE })).toHaveCount(0)

  // Not merely a UI state: the API genuinely does not serve this browser.
  expect((await page.request.get(GUARDED)).status()).toBe(401)
})

test('a wrong code is refused, in the words the backend used', async ({ page }) => {
  await page.goto('/app')
  await page.getByLabel('Invite code').fill('not-the-code')
  await page.getByRole('button', { name: /Continue/i }).click()

  await expect(page.getByRole('alert')).toHaveText(/Invalid invite code/i)
  // Still gated — a rejected code must not fall through to the pipeline.
  await expect(page.getByRole('heading', { name: GATE })).toBeVisible()
  expect((await page.request.get(GUARDED)).status()).toBe(401)
})

test('a valid code signs the browser in, and the session survives a reload', async ({
  page,
}) => {
  await page.goto('/app')
  await page.getByLabel('Invite code').fill(INVITE_CODE)
  await page.getByRole('button', { name: /Continue/i }).click()

  // The gate gives way to the pipeline's first screen.
  await expect(page.getByRole('heading', { name: PIPELINE })).toBeVisible()
  await expect(page.getByRole('heading', { name: GATE })).toHaveCount(0)

  // The credential is where scripts cannot reach it, and is not the code.
  const cookies = await page.context().cookies()
  const session = cookies.find((c) => c.name === 'rejox_session')
  expect(session, 'a session cookie was set').toBeTruthy()
  expect(session!.httpOnly).toBe(true)
  expect(session!.value).not.toContain(INVITE_CODE)
  expect(await page.evaluate(() => document.cookie)).not.toContain('rejox_session')

  // And the API now serves this browser: 404 for a missing job, not 401.
  expect((await page.request.get(GUARDED)).status()).toBe(404)

  // THE assertion this file exists for. A cross-origin API base passes
  // everything above and fails here: the cookie is never sent back, so the
  // reloaded app asks /api/session and is told it is signed out.
  await page.reload()
  await expect(page.getByRole('heading', { name: PIPELINE })).toBeVisible()
  await expect(page.getByRole('heading', { name: GATE })).toHaveCount(0)

  // Dropping the cookie puts the gate back — the session is the only thing
  // holding it open.
  await page.context().clearCookies()
  await page.reload()
  await expect(page.getByRole('heading', { name: GATE })).toBeVisible()
})
