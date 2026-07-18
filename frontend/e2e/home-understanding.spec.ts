import { test, expect, type Page } from '@playwright/test'

/**
 * Home page — the "Understanding" section (Scene 01).
 *
 * Proves: (1) the hero at scroll 0 is pixel-identical to before this section
 * existed (the pillar canvas is hidden for determinism); (2) the GSAP pin
 * engages and drives a beat index 0 → 1 → 2 then releases; (3) the CTA's
 * ScrollReveal still fires after scrolling past the pinned section (the
 * coexistence guarantee); (4) with reduced motion the section renders unpinned
 * with all three slots visible.
 *
 * The section exposes its scroll state to the DOM for deterministic assertions:
 *   [data-rx-understanding]  data-pinned="true|false"  data-beat="0|1|2"
 *   data-reduced="true|false"
 */

const DESKTOP = { width: 1440, height: 900 }

// The WebGL light pillar animates every frame, so it must be hidden before any
// screenshot or the comparison is nondeterministic. visibility (not display)
// keeps layout byte-identical.
const HIDE_PILLAR = '.rx-pillar-fixed { visibility: hidden !important; }'

// Disable WebGL so LightPillar takes its documented "WebGL not supported"
// fallback instead of creating a GPU context. This is purely for e2e
// determinism/stability — repeatedly mounting the live shader across tests (×2
// under StrictMode) wedges the shared GPU process and hangs page.evaluate. The
// fallback renders inside the already-hidden .rx-pillar-fixed layer, so no
// visible pixel changes vs. a hidden live canvas — the hero baseline holds.
async function disableWebGL(page: Page) {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: any[]) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (orig as any).call(this, type, ...args)
    } as typeof HTMLCanvasElement.prototype.getContext
  })
}

async function gotoHome(page: Page) {
  await page.setViewportSize(DESKTOP)
  await disableWebGL(page)
  await page.goto('/')
  await page.addStyleTag({ content: HIDE_PILLAR })
  // The hero's framer-motion entrance is a JS/rAF one-shot; Playwright's
  // animation freezing does not touch it, so wait for it to settle.
  await page.waitForTimeout(1200)
}

const section = (page: Page) => page.locator('[data-rx-understanding]')

/** Scroll to an absolute Y and let ScrollTrigger's scrub settle. */
async function scrollTo(page: Page, y: number) {
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' as ScrollBehavior }), y)
  await page.waitForTimeout(250)
}

test.describe('Home / Understanding section', () => {
  test('hero at scroll 0 is pixel-identical to before this change', async ({ page }) => {
    await gotoHome(page)
    await scrollTo(page, 0)
    // Full-viewport hero shot; the pillar is hidden so only static content remains.
    expect(await page.screenshot({ animations: 'disabled' })).toMatchSnapshot(
      'hero-scroll0.png',
      { maxDiffPixels: 0 },
    )
  })

  test('pin engages, beat advances 0 → 1 → 2, then releases', async ({ page }) => {
    await gotoHome(page)
    const sec = section(page)
    await expect(sec).toHaveCount(1)

    // Bring the section's top to the top of the viewport → pin engages.
    const top = await sec.evaluate((el) => el.getBoundingClientRect().top + window.scrollY)

    // Beat 0 — just after the pin engages.
    await scrollTo(page, top + 10)
    await expect(sec).toHaveAttribute('data-pinned', 'true')
    await expect(sec).toHaveAttribute('data-beat', '0')

    // StrictMode (dev) mounts → cleans up → remounts. If cleanup failed to kill
    // the first trigger, its pin-spacer would survive and we'd see two. Exactly
    // one pin-spacer on the page proves the pin neither broke nor duplicated.
    await expect(page.locator('.pin-spacer')).toHaveCount(1)
    await page.screenshot({ path: 'test-results/understanding-beat-0.png', animations: 'disabled' })

    // Beat 1 — one beat's worth of scroll further in.
    const dist = await page.evaluate(() => window.innerHeight)
    await scrollTo(page, top + dist * 1.2)
    await expect(sec).toHaveAttribute('data-pinned', 'true')
    await expect(sec).toHaveAttribute('data-beat', '1')
    await page.screenshot({ path: 'test-results/understanding-beat-1.png', animations: 'disabled' })

    // Beat 2 — near the end of the pinned range.
    await scrollTo(page, top + dist * 2.2)
    await expect(sec).toHaveAttribute('data-pinned', 'true')
    await expect(sec).toHaveAttribute('data-beat', '2')
    await page.screenshot({ path: 'test-results/understanding-beat-2.png', animations: 'disabled' })

    // Scroll well past → pin releases.
    await scrollTo(page, top + dist * 4)
    await expect(sec).toHaveAttribute('data-pinned', 'false')
  })

  test('CTA ScrollReveal still fires after scrolling past the pinned section', async ({ page }) => {
    await gotoHome(page)

    // The pinned section sits between the hero and the CTA, so reaching the CTA
    // necessarily scrolls THROUGH the whole pin (past its released end). Scroll
    // the CTA's first reveal word to near the top of the viewport, which is well
    // past ScrollReveal's entrance end ('top center') → the word is fully
    // revealed. If the pin had displaced or broken ScrollReveal's triggers, the
    // word would still sit at baseOpacity 0.
    const firstWord = page.locator('.rx-cta-word .word').first()
    const opacity = () => firstWord.evaluate((el) => parseFloat(getComputedStyle(el).opacity))
    const ih = await page.evaluate(() => window.innerHeight)
    const wordTop = await firstWord.evaluate((el) => el.getBoundingClientRect().top + window.scrollY)

    // BEFORE: park the word low in the viewport (just entering from the bottom),
    // where ScrollReveal's entrance scrub has barely begun → it is NOT yet
    // revealed. (The four words reveal word-by-word by design, so we prove the
    // mechanism on the first word's own 0 → 1 transition rather than expecting
    // all four opaque at once, which their combined height makes impossible.)
    await scrollTo(page, wordTop - (ih - 140))
    expect(await opacity()).toBeLessThan(0.6)

    // AFTER: scroll the word up past ScrollReveal's entrance end ('top center')
    // → fully revealed. Reaching here means we scrolled through the entire pin.
    await scrollTo(page, wordTop - 120)
    await expect(section(page)).toHaveAttribute('data-pinned', 'false')
    await expect.poll(opacity, { timeout: 8000 }).toBeGreaterThan(0.9)

    // Log the full four-word reveal state for the report.
    const opacities = await page
      .locator('.rx-cta-word .word')
      .evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).opacity)))
    // eslint-disable-next-line no-console
    console.log('[e2e] CTA word opacities after pin:', opacities.map((o) => o.toFixed(2)).join(', '))

    await page.screenshot({ path: 'test-results/understanding-cta-coexist.png', animations: 'disabled' })
  })

  test('reduced motion: section renders unpinned with all three slots visible', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await gotoHome(page)
    const sec = section(page)
    await expect(sec).toHaveCount(1)
    await expect(sec).toHaveAttribute('data-reduced', 'true')
    await expect(sec).toHaveAttribute('data-pinned', 'false')

    // All three placeholder slots are present and visible, none dimmed.
    const slots = page.locator('[data-rx-slot]')
    await expect(slots).toHaveCount(3)
    for (let i = 0; i < 3; i++) await expect(slots.nth(i)).toBeVisible()

    // Bring the section into view for the screenshot.
    await sec.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'test-results/understanding-reduced-motion.png', animations: 'disabled' })
  })
})
