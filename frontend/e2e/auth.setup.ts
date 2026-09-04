import { expect, test as setup } from '@playwright/test'

import { INVITE_CODE, SESSION_STATE } from './session'

/**
 * Sign in once, and save the cookie for every project that depends on this one.
 *
 * The e2e backend runs the REAL posture — invite codes configured, so nothing
 * is anonymous — which means the pipeline screens are behind the gate. Driving
 * that gate through the UI is `sign-in.spec.ts`'s job; the other specs are
 * about what happens after it, so they start from a session established here.
 */
setup('sign in for the pipeline specs', async ({ page }) => {
  const resp = await page.request.post('/api/session', {
    data: { code: INVITE_CODE },
  })
  expect(resp.status(), await resp.text()).toBe(200)
  expect((await resp.json()).signedIn).toBe(true)

  // page.request shares the context's cookie jar, so the Set-Cookie above is
  // already in it; this writes it where the dependent projects load it from.
  await page.context().storageState({ path: SESSION_STATE })
})
