import { test, expect, type Page } from '@playwright/test'

/**
 * Home page — the page chrome refinements:
 *   (1) the auto-hiding header (hide on scroll down, reveal on scroll up),
 *       including scrolling through the Scene 01 section, and the resolution
 *       of the old nav-capsule ↔ Scene 02 heading overlap;
 *   (2) the header logo as a real, focusable scroll-to-top control;
 *   (3) the CTA word reveal — sharp (zero blur, full opacity) through the middle
 *       band of the viewport, blurred only near the edges;
 *   (4) a reduced-motion pass: header snaps, logo jumps, nothing hidden.
 */

const DESKTOP = { width: 1440, height: 900 }
// Middle band of the viewport within which every CTA word must be perfectly
// sharp. Generous on purpose: the last word ("Ship.") is clamped by the page
// bottom and can only rise to ~64% center, so it must be sharp across the whole
// band it can reach, not just at an unreachable 50%.
const BAND = { top: 30, bottom: 70 }

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
  await page.addStyleTag({ content: '.rx-pillar-fixed { visibility: hidden !important; }' })
  await page.waitForTimeout(1000)
}

const header = (page: Page) => page.locator('.rx-header')
const hiddenAttr = (page: Page) => header(page).getAttribute('data-hidden')

async function scrollTo(page: Page, y: number) {
  await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: 'instant' as ScrollBehavior }), y)
  await page.waitForTimeout(140) // let the rAF-throttled scroll handler run
}
async function scrollBy(page: Page, dy: number) {
  await page.evaluate((d) => window.scrollBy({ top: d, behavior: 'instant' as ScrollBehavior }), dy)
  await page.waitForTimeout(140)
}
const scrollYOf = (page: Page, sel: string) =>
  page.locator(sel).evaluate((el) => el.getBoundingClientRect().top + window.scrollY)

test.describe('Home / header auto-hide', () => {
  test('visible at the top, hidden on scroll-down past the hero, visible again on scroll-up', async ({ page }) => {
    await gotoHome(page)

    // 1. At the top the hero fills the viewport → header is visible.
    await scrollTo(page, 0)
    expect(await hiddenAttr(page)).toBe('false')
    expect(await header(page).evaluate((el) => getComputedStyle(el).top)).toBe('20px')

    // 2. Scroll well past the hero → header slides out of the way.
    const uTop = await scrollYOf(page, '[data-rx-understanding]')
    await scrollTo(page, uTop + 400)
    expect(await hiddenAttr(page)).toBe('true')

    // 3. Scroll UP by a meaningful amount → it comes straight back (the user did
    //    NOT have to return to the top).
    await scrollBy(page, -150)
    expect(await hiddenAttr(page)).toBe('false')
  })

  test('a small threshold swallows jitter (tiny scrolls do not toggle it)', async ({ page }) => {
    await gotoHome(page)
    const dTop = await scrollYOf(page, '[data-rx-decisions]')
    await scrollTo(page, dTop) // header hidden here (arrived scrolling down)
    const before = await hiddenAttr(page)
    // Sub-threshold jitter in both directions.
    await scrollBy(page, 4)
    await scrollBy(page, -3)
    await scrollBy(page, 5)
    expect(await hiddenAttr(page)).toBe(before)
  })

  test('auto-hide keeps working while scrolling through the Understanding section', async ({ page }) => {
    await gotoHome(page)
    const uTop = await scrollYOf(page, '[data-rx-understanding]')

    // Scrolled down into (and past) the section, arrived scrolling down → hidden.
    await scrollTo(page, uTop + 400)
    expect(await hiddenAttr(page)).toBe('true')

    // Scroll up → header returns.
    await scrollBy(page, -150)
    expect(await hiddenAttr(page)).toBe('false')

    // Scroll down again → hides again.
    await scrollBy(page, 300)
    expect(await hiddenAttr(page)).toBe('true')
  })

  test('no longer overlaps Scene 02 heading (screenshot of the hidden-header state)', async ({ page }) => {
    await gotoHome(page)
    const dTop = await scrollYOf(page, '[data-rx-decisions]')
    // Land on the Scene 02 heading via a net-downward scroll → header hidden.
    await scrollTo(page, dTop - 300)
    await scrollTo(page, dTop)
    expect(await hiddenAttr(page)).toBe('true')
    // The capsule is parked fully above the viewport, so it cannot collide with
    // the heading beneath it.
    const top = parseFloat(await header(page).evaluate((el) => getComputedStyle(el).top))
    expect(top).toBeLessThan(0)
    await page.screenshot({ path: 'test-results/header-scene2-no-overlap.png' })
  })
})

test.describe('Home / header logo', () => {
  test('pointer cursor, keyboard-focusable, and clicking returns to the hero', async ({ page }) => {
    await gotoHome(page)
    const logo = page.locator('.rx-logo-btn')

    // A real interactive control with an accessible name.
    expect(await logo.evaluate((el) => el.tagName)).toBe('BUTTON')
    expect(await logo.getAttribute('aria-label')).toBeTruthy()

    // Pointer cursor on hover.
    expect(await logo.evaluate((el) => getComputedStyle(el).cursor)).toBe('pointer')

    // Keyboard-focusable.
    await logo.focus()
    expect(await page.evaluate(() => document.activeElement?.classList.contains('rx-logo-btn'))).toBe(true)

    // Clicking returns the page to the hero. Scroll away first, reveal the header
    // (scroll up a hair so it is on-screen and clickable), then click.
    const dTop = await scrollYOf(page, '[data-rx-decisions]')
    await scrollTo(page, dTop)
    await scrollBy(page, -60) // reveal the header
    expect(await hiddenAttr(page)).toBe('false')
    await logo.click()
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 4000 }).toBe(0)
  })
})

test.describe('Home / CTA word reveal', () => {
  test('every word is sharp while centred (entrance unchanged) AND sharp while exiting above centre', async ({ page }) => {
    await gotoHome(page)
    const count = await page.locator('.rx-cta-word .word').count()
    expect(count).toBe(4)

    const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
    // Per word, over a full-page scroll sweep:
    //  - the entrance (centred, band 30–70%): worst blur / worst opacity — must be
    //    0 / 1, proving the entrance is UNCHANGED;
    //  - the exit (above the viewport centre, ≤ 45%): worst blur — must be 0,
    //    proving the exit no longer blurs. We also record whether a word actually
    //    reached the exit region while fading (opacity < 1), so the exit claim is
    //    demonstrated on real exits, not just vacuously true.
    const bandBlur = new Array(count).fill(0)
    const bandOpacity = new Array(count).fill(1)
    const reachedBand = new Array(count).fill(false)
    const exitBlur = new Array(count).fill(0)
    const exitFadingSharp = new Array(count).fill(false) // reached exit region with opacity<1 and blur 0
    const highestCenter = new Array(count).fill(101)

    for (let y = 0; y <= maxScroll; y += 40) {
      await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: 'instant' as ScrollBehavior }), y)
      await page.waitForTimeout(14)
      const snap = await page.evaluate(() => {
        const ws = document.querySelectorAll<HTMLElement>('.rx-cta-word .word')
        return Array.from(ws).map((w) => {
          const cs = getComputedStyle(w)
          const r = w.getBoundingClientRect()
          const center = ((r.top + r.height / 2) / window.innerHeight) * 100
          const m = cs.filter.match(/blur\(([\d.]+)px\)/)
          return { center, blur: m ? parseFloat(m[1]) : 0, opacity: parseFloat(cs.opacity) }
        })
      })
      snap.forEach((s, i) => {
        highestCenter[i] = Math.min(highestCenter[i], s.center)
        if (s.center >= BAND.top && s.center <= BAND.bottom) {
          reachedBand[i] = true
          bandBlur[i] = Math.max(bandBlur[i], s.blur)
          bandOpacity[i] = Math.min(bandOpacity[i], s.opacity)
        }
        if (s.center <= 45) {
          // At or above the viewport centre → the exit region.
          exitBlur[i] = Math.max(exitBlur[i], s.blur)
          if (s.opacity < 0.999 && s.blur === 0) exitFadingSharp[i] = true
        }
      })
    }

    const labels = ['Upload', 'Wait', 'Review', 'Ship']
    labels.forEach((label, i) => {
      // eslint-disable-next-line no-console
      console.log(
        `[e2e] CTA ${label}: centred[blur=${bandBlur[i].toFixed(3)} op=${bandOpacity[i].toFixed(3)}] ` +
          `exit[blur=${exitBlur[i].toFixed(3)} fadingSharp=${exitFadingSharp[i]}] highestCenter=${highestCenter[i].toFixed(1)}%`,
      )
      // Entrance unchanged: sharp + fully opaque while centred.
      expect(reachedBand[i], `${label} never reached the middle band`).toBe(true)
      expect(bandBlur[i], `${label} blurred while centred`).toBe(0)
      expect(bandOpacity[i], `${label} faded while centred`).toBe(1)
      // Exit no longer blurs: zero blur anywhere at/above the viewport centre.
      expect(exitBlur[i], `${label} blurred while exiting above centre`).toBe(0)
    })

    // …and prove the exit claim on a real exit: the top word ("Upload") rises well
    // above the centre and into the opacity-fade (its opacity drops) while staying
    // perfectly sharp — the direct demonstration that the exit no longer blurs.
    // (The lower words are progressively clamped toward the centre by the page
    // bottom — Wait ~34%, Review ~47%, Ship ~60% — so only Upload reaches deep
    // enough to fade; all four are asserted sharp wherever they do reach, above.)
    expect(exitFadingSharp[0], 'Upload should exit above centre while fading, and stay sharp').toBe(true)

    // Screenshot the exit: the words scrolled above centre, fading yet sharp.
    await page.evaluate(() => {
      const w = document.querySelectorAll<HTMLElement>('.rx-cta-word .word')[0]
      const r = w.getBoundingClientRect()
      window.scrollTo({ top: window.scrollY + r.top - window.innerHeight * 0.12, behavior: 'instant' as ScrollBehavior })
    })
    await page.waitForTimeout(300)
    await page.locator('.rx-cta').screenshot({ path: 'test-results/cta-exit-sharp.png' })
  })
})

test.describe('Home / footer', () => {
  test('is a thin quiet sign-off at the very bottom, after the CTA', async ({ page }) => {
    await gotoHome(page)
    const footer = page.locator('.rx-footer')
    await expect(footer).toHaveCount(1)

    // It is the last element on the page, below the CTA.
    const order = await page.evaluate(() => {
      const cta = document.querySelector('.rx-cta')!
      const foot = document.querySelector('.rx-footer')!
      return {
        afterCta: !!(cta.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING),
        isLast: foot === document.querySelector('.rx-home')!.lastElementChild,
      }
    })
    expect(order.afterCta).toBe(true)
    expect(order.isLast).toBe(true)

    // Plain-text wordmark + a copyright line for 2026; no logo/icon inside.
    await expect(page.locator('.rx-footer-mark')).toHaveText('rejox')
    expect(await page.locator('.rx-footer-copy').textContent()).toContain('2026')
    expect(await footer.locator('img, svg').count()).toBe(0)

    // A thin strip — short in height.
    await footer.scrollIntoViewIfNeeded()
    const height = await footer.evaluate((el) => el.getBoundingClientRect().height)
    // eslint-disable-next-line no-console
    console.log(`[e2e] footer height=${height.toFixed(1)}px`)
    expect(height).toBeLessThan(72)

    await footer.screenshot({ path: 'test-results/footer.png' })
  })
})

test.describe('Home / reduced motion', () => {
  test('header snaps (no transition), logo jumps, and nothing is hidden', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await gotoHome(page)

    // Header transition is disabled → it snaps between shown/hidden.
    expect(await header(page).evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s')

    // …but it still toggles on scroll (the behaviour stays; only the animation goes).
    const uTop = await scrollYOf(page, '[data-rx-understanding]')
    await scrollTo(page, uTop + 400)
    expect(await hiddenAttr(page)).toBe('true')

    // Nothing hidden: the Scene 02 blocks and the footer are all fully visible.
    const opac = await page.evaluate(() =>
      ['.rx-d-decision', '.rx-d-join', '.rx-d-proof', '.rx-d-attribution', '.rx-footer', '.rx-footer-mark', '.rx-footer-copy'].map(
        (s) => parseFloat(getComputedStyle(document.querySelector(s)!).opacity),
      ),
    )
    opac.forEach((o) => expect(o).toBeGreaterThan(0.9))
    await expect(page.locator('.rx-footer')).toBeVisible()

    // Logo click JUMPS to the top instead of smooth-scrolling: after a short wait
    // (far less than the ~0.9s smooth animation) it is already there.
    await scrollBy(page, -60) // reveal header
    expect(await hiddenAttr(page)).toBe('false')
    await page.locator('.rx-logo-btn').click()
    await page.waitForTimeout(150)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })
})
