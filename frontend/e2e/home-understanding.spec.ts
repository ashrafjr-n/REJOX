import { test, expect, type Page } from '@playwright/test'

/**
 * Home page — the "Understanding" section (Scene 01).
 *
 * Proves: (1) the hero at scroll 0 is pixel-identical to before this section
 * existed (the pillar canvas is hidden for determinism); (2) the GSAP pin
 * engages and the scrubbed morph advances raw files → knowledge graph (beat 1
 * settled, midpoint, beat 2 settled), then releases; (3) the CTA's ScrollReveal
 * still fires after scrolling past the pinned section (the coexistence
 * guarantee); (4) with reduced motion the finished graph is shown with nothing
 * hidden; (5) the scrub stays smooth (frame timing).
 *
 * The section exposes its scroll state to the DOM for deterministic assertions:
 *   [data-rx-understanding]  data-pinned="true|false"  data-beat="0|1|2"
 *   data-progress="0..1"  data-reduced="true|false"
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
  await page.waitForTimeout(300)
}

/** Computed opacity of the first graph node (GSAP drives this inline). */
function firstNodeOpacity(page: Page): Promise<number> {
  return page
    .locator('.rx-u-node')
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).opacity))
}

/** The largest stroke-dashoffset across a set of edges — 0 means every edge is
 *  fully drawn (pathLength=1, so offset runs 1 → 0). */
function maxDashoffset(page: Page, selector: string): Promise<number> {
  return page
    .locator(selector)
    .evaluateAll((els) =>
      Math.max(...els.map((el) => Math.abs(parseFloat(getComputedStyle(el).strokeDashoffset || '0')))),
    )
}

/** Opacity of the active readout group for a given beat (0/1/2). */
function readoutGroupOpacity(page: Page, group: number): Promise<number> {
  return page
    .locator(`.rx-u-rgroup[data-group="${group}"]`)
    .evaluate((el) => parseFloat(getComputedStyle(el).opacity))
}

/** Opacity of the first wave column (the W1…W9 scaffolding, revealed in beat 3). */
function firstWaveColOpacity(page: Page): Promise<number> {
  return page
    .locator('.rx-u-wave-col')
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).opacity))
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

  test('pin engages; morph advances files → graph → waves, then releases', async ({ page }) => {
    await gotoHome(page)
    const sec = section(page)
    await expect(sec).toHaveCount(1)

    const top = await sec.evaluate((el) => el.getBoundingClientRect().top + window.scrollY)
    const ih = await page.evaluate(() => window.innerHeight)
    // The pinned range is 3 viewports; progress p ⇒ scrollY = top + p*3*ih.
    const atProgress = (p: number) => scrollTo(page, top + p * 3 * ih)

    // Pin engages.
    await atProgress(0.02)
    await expect(sec).toHaveAttribute('data-pinned', 'true')
    // StrictMode (dev) mounts → cleans up → remounts. Exactly one pin-spacer
    // proves the pin neither broke nor duplicated.
    await expect(page.locator('.pin-spacer')).toHaveCount(1)

    // BEAT 1 — raw files; nodes still hidden. Readout: file group active.
    await atProgress(0.12)
    await expect(sec).toHaveAttribute('data-beat', '0')
    expect(await firstNodeOpacity(page)).toBeLessThan(0.1)
    expect(await readoutGroupOpacity(page, 0)).toBeGreaterThan(0.9) // files
    expect(await readoutGroupOpacity(page, 2)).toBeLessThan(0.1) // plan hidden
    await page.screenshot({ path: 'test-results/understanding-beat1-files.png', animations: 'disabled' })

    // Files → graph midpoint.
    await atProgress(0.46)
    await expect(sec).toHaveAttribute('data-beat', '1')
    await page.screenshot({ path: 'test-results/understanding-midpoint.png', animations: 'disabled' })

    // BEAT 2 — the graph, fully drawn. Readout: graph group active.
    await atProgress(0.62)
    await expect(sec).toHaveAttribute('data-beat', '1')
    expect(await firstNodeOpacity(page)).toBeGreaterThan(0.9)
    expect(await maxDashoffset(page, '.rx-u-edge')).toBeLessThan(0.02)
    expect(await readoutGroupOpacity(page, 1)).toBeGreaterThan(0.9) // graph
    await page.screenshot({ path: 'test-results/understanding-beat2-graph.png', animations: 'disabled' })

    // BEAT 3 mid-transition — nodes migrating into wave columns.
    await atProgress(0.8)
    await expect(sec).toHaveAttribute('data-beat', '2')
    await page.screenshot({ path: 'test-results/understanding-beat3-mid.png', animations: 'disabled' })

    // BEAT 3 settled — wave columns visible, build-order edges drawn. Readout:
    // plan group active.
    await atProgress(0.97)
    await expect(sec).toHaveAttribute('data-beat', '2')
    expect(await maxDashoffset(page, '.rx-u-wave-edge')).toBeLessThan(0.02)
    expect(await firstWaveColOpacity(page)).toBeGreaterThan(0.9)
    expect(await readoutGroupOpacity(page, 2)).toBeGreaterThan(0.9) // plan
    expect(await readoutGroupOpacity(page, 0)).toBeLessThan(0.1) // files hidden
    await page.screenshot({ path: 'test-results/understanding-beat3-settled.png', animations: 'disabled' })

    // Scroll well past → pin releases.
    await scrollTo(page, top + ih * 4)
    await expect(sec).toHaveAttribute('data-pinned', 'false')
  })

  for (const phase of [
    { name: 'files→graph', a: 0.3, b: 0.66 },
    { name: 'beat-3 graph→waves', a: 0.66, b: 1.0 },
  ]) {
    test(`the ${phase.name} scrub stays smooth (frame timing)`, async ({ page }) => {
      await gotoHome(page)
      const sec = section(page)
      const top = await sec.evaluate((el) => el.getBoundingClientRect().top + window.scrollY)
      const ih = await page.evaluate(() => window.innerHeight)

      // Sample rAF frame deltas while stepping the scroll through the phase's
      // window over ~1.2s of real time, the way a wheel would.
      const timing = await page.evaluate(
        async ({ top, ih, a, b }) => {
          const deltas: number[] = []
          let last = performance.now()
          let running = true
          const sample = () => {
            const now = performance.now()
            deltas.push(now - last)
            last = now
            if (running) requestAnimationFrame(sample)
          }
          requestAnimationFrame(sample)
          const start = top + a * 3 * ih
          const end = top + b * 3 * ih
          const steps = 60
          for (let i = 0; i <= steps; i++) {
            window.scrollTo({ top: start + ((end - start) * i) / steps, behavior: 'instant' as ScrollBehavior })
            await new Promise((r) => setTimeout(r, 20))
          }
          running = false
          await new Promise((r) => requestAnimationFrame(() => r(null)))
          deltas.shift()
          const sorted = [...deltas].sort((x, y) => x - y)
          const avg = deltas.reduce((s, d) => s + d, 0) / deltas.length
          const p95 = sorted[Math.floor(sorted.length * 0.95)]
          const worst = sorted[sorted.length - 1]
          const longFrames = deltas.filter((d) => d > 33).length
          return { frames: deltas.length, avg, p95, worst, longFrames }
        },
        { top, ih, a: phase.a, b: phase.b },
      )
      // eslint-disable-next-line no-console
      console.log(
        `[e2e] ${phase.name} frame timing — frames=${timing.frames} avg=${timing.avg.toFixed(1)}ms ` +
          `p95=${timing.p95.toFixed(1)}ms worst=${timing.worst.toFixed(1)}ms longFrames(>33ms)=${timing.longFrames}`,
      )
      expect(timing.p95).toBeLessThan(50)
    })
  }

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

  test('reduced motion: build-order arrangement, file list, full readout, nothing hidden', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await gotoHome(page)
    const sec = section(page)
    await expect(sec).toHaveCount(1)
    await expect(sec).toHaveAttribute('data-reduced', 'true')
    await expect(sec).toHaveAttribute('data-pinned', 'false')

    // The settled build-order arrangement is shown immediately: nodes visible,
    // wave columns labelled, build-order edges fully drawn.
    await expect(page.locator('.rx-u-node').first()).toBeVisible()
    expect(await firstNodeOpacity(page)).toBeGreaterThan(0.9)
    expect(await firstWaveColOpacity(page)).toBeGreaterThan(0.9)
    expect(await maxDashoffset(page, '.rx-u-wave-edge')).toBeLessThan(0.02)

    // The source-file list is shown statically, and ALL three readout groups are
    // visible at once (nothing beat-dependent), plus no pin-spacer.
    await expect(page.locator('.rx-u-filelist li').first()).toBeVisible()
    for (let g = 0; g < 3; g++) expect(await readoutGroupOpacity(page, g)).toBeGreaterThan(0.9)
    await expect(page.locator('.pin-spacer')).toHaveCount(0)

    await sec.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'test-results/understanding-reduced-motion.png', animations: 'disabled', fullPage: true })
  })
})
