import { test, expect, type Page } from '@playwright/test'

import showcase from '../src/data/showcase.json' with { type: 'json' }

/**
 * Home page — the "Decisions" section (Scene 02).
 *
 * Proves: (1) the three parts reveal on scroll (beat A, the joining LLM line,
 * beat B); (2) the validated figure, its lens label, and the stricter figure all
 * match the data and are genuinely visible; (3) the section coexists with the
 * Scene 01 pin and the CTA's ScrollReveal; (4) reduced motion shows everything.
 */

const DESKTOP = { width: 1440, height: 900 }
const r = showcase.results

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

const section = (page: Page) => page.locator('[data-rx-decisions]')

/** Count the rendered lines of an element's text by grouping its text
 *  client-rects by their (rounded) top edge — one distinct top per visual line.
 *  Independent of how the wrap happens (natural, max-width, or an explicit
 *  <br>), so it measures what actually renders. */
async function renderedLineCount(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const tops = new Set<number>()
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width > 0.5) tops.add(Math.round(rect.top))
    }
    return tops.size
  })
}

/** Reveal an element by scrolling it into the viewport and letting the one-shot
 *  fade-up finish, then return its computed opacity. */
async function revealOpacity(page: Page, selector: string): Promise<number> {
  await page.locator(selector).scrollIntoViewIfNeeded()
  await page.waitForTimeout(700)
  return page.locator(selector).evaluate((el) => parseFloat(getComputedStyle(el).opacity))
}

test.describe('Home / Decisions section', () => {
  test('beat A, the joining line, and beat B reveal on scroll', async ({ page }) => {
    await gotoHome(page)
    await expect(section(page)).toHaveCount(1)

    // Beat A — the decision. Evidence precedes the question in the DOM.
    expect(await revealOpacity(page, '.rx-d-decision')).toBeGreaterThan(0.9)
    await page.locator('.rx-d-decision').screenshot({ path: 'test-results/decisions-beatA.png' })

    // The joining line — the whole-run LLM count, isolated.
    expect(await revealOpacity(page, '.rx-d-join')).toBeGreaterThan(0.9)
    await page.locator('.rx-d-join').screenshot({ path: 'test-results/decisions-join.png' })

    // Beat B — the proof.
    expect(await revealOpacity(page, '.rx-d-proof')).toBeGreaterThan(0.9)
    await page.locator('.rx-d-proof').screenshot({ path: 'test-results/decisions-beatB.png' })
  })

  test('validated figure, its lens, and the strict figure all match the data and are visible', async ({ page }) => {
    await gotoHome(page)
    await page.locator('.rx-d-proof').scrollIntoViewIfNeeded()
    await page.waitForTimeout(700)

    // The headline validated figure matches the data's working-coverage lens.
    const validated = page.getByTestId('validated-coverage')
    await expect(validated).toBeVisible()
    expect((await validated.textContent())?.trim()).toBe(`${r.validatedCoverage}%`)

    // Its lens is labelled explicitly (so 100% is never an unqualified claim).
    const lens = page.getByTestId('validated-lens')
    await expect(lens).toBeVisible()
    expect((await lens.textContent())?.toLowerCase()).toContain('working')

    // The stricter, lower figure is present in the DOM and genuinely visible —
    // not behind a hover or tooltip, not omitted.
    const strict = page.getByTestId('strict-coverage')
    await expect(strict).toBeVisible()
    expect(await strict.textContent()).toContain(String(r.validatedStrictCoverage))
    // …and it is a DIFFERENT, lower number than the headline.
    expect(r.validatedStrictCoverage).toBeLessThan(r.validatedCoverage)

    // Predicted is a distinct measurement, shown separately.
    const predicted = page.getByTestId('predicted-coverage')
    await expect(predicted).toBeVisible()
    expect((await predicted.textContent())?.trim()).toBe(`${r.predictedCoverage}%`)
    expect(r.predictedCoverage).not.toBe(r.validatedCoverage)
  })

  test('coexists with the Scene 01 pin and the CTA ScrollReveal', async ({ page }) => {
    await gotoHome(page)

    // Scene 01 pin still engages (Decisions sits after it, not disturbing it).
    const understanding = page.locator('[data-rx-understanding]')
    const uTop = await understanding.evaluate((el) => el.getBoundingClientRect().top + window.scrollY)
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }), uTop + 10)
    await page.waitForTimeout(300)
    await expect(understanding).toHaveAttribute('data-pinned', 'true')
    await expect(page.locator('.pin-spacer')).toHaveCount(1)
    await page.screenshot({ path: 'test-results/decisions-coexist-pin.png', animations: 'disabled' })

    // The CTA's ScrollReveal still fires after scrolling past BOTH sections.
    const firstWord = page.locator('.rx-cta-word .word').first()
    const wordTop = await firstWord.evaluate((el) => el.getBoundingClientRect().top + window.scrollY)
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }), wordTop - 120)
    await page.waitForTimeout(400)
    await expect(understanding).toHaveAttribute('data-pinned', 'false') // scrolled past the pin
    await expect
      .poll(() => firstWord.evaluate((el) => parseFloat(getComputedStyle(el).opacity)), { timeout: 8000 })
      .toBeGreaterThan(0.9)
    await page.screenshot({ path: 'test-results/decisions-coexist-cta.png', animations: 'disabled' })
  })

  test('the section is exactly one viewport tall at 1440×900', async ({ page }) => {
    await gotoHome(page)
    const measured = await section(page).evaluate((el) => el.getBoundingClientRect().height)
    // Restructured to a single viewport: content + padding sits under 100vh, so
    // min-height:100vh clamps the section to exactly one viewport — nothing
    // cropped, nothing scrolled inside it.
    expect(measured).toBe(DESKTOP.height)

    // A full-section screenshot of the reworked layout (revealed).
    await section(page).scrollIntoViewIfNeeded()
    await page.waitForTimeout(800)
    await section(page).screenshot({ path: 'test-results/decisions-section.png' })
  })

  test('the decision card and the "1 LLM call" line finish level (columns bottom-aligned)', async ({ page }) => {
    await gotoHome(page)
    await section(page).scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    const bottoms = await page.evaluate(() => {
      const dec = document.querySelector('.rx-d-decision')!.getBoundingClientRect()
      // The joining unit's LAST line is the "N LLM call · entire migration" cap.
      const cap = document.querySelector('.rx-d-join-cap')!.getBoundingClientRect()
      return { decisionBottom: dec.bottom, llmLineBottom: cap.bottom }
    })
    const diff = Math.abs(bottoms.decisionBottom - bottoms.llmLineBottom)
    // Achieved through the layout (stretched right column + join pushed to its
    // bottom), not a hard-coded height — so the two columns finish level.
    // eslint-disable-next-line no-console
    console.log(`[e2e] Scene02 bottoms: decisionCard=${bottoms.decisionBottom.toFixed(1)} llmLine=${bottoms.llmLineBottom.toFixed(1)} diff=${diff.toFixed(2)}px`)
    expect(diff).toBeLessThanOrEqual(2)
  })

  test('"AI was needed once." renders on a single line', async ({ page }) => {
    await gotoHome(page)
    await page.locator('.rx-d-join').scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    const joinLine = page.locator('.rx-d-join-line')
    expect((await joinLine.textContent())?.trim()).toBe('AI was needed once.')
    // On the wider right column it sits on one line, not wrapped.
    expect(await renderedLineCount(page, '.rx-d-join-line')).toBe(1)
  })

  test('the heading renders on exactly two lines', async ({ page }) => {
    await gotoHome(page)
    // Deliberately broken between the two sentences — exactly two lines at the
    // reference width, not three.
    expect(await renderedLineCount(page, '.rx-d-heading')).toBe(2)
  })

  test('reduced motion: the whole section is visible with nothing hidden', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await gotoHome(page)
    const sec = section(page)
    await expect(sec).toHaveAttribute('data-reduced', 'true')

    // Every revealable block is fully opaque immediately (no scroll needed).
    const blocks = ['.rx-d-decision', '.rx-d-join', '.rx-d-proof', '.rx-d-attribution']
    for (const sel of blocks) {
      expect(await page.locator(sel).evaluate((el) => parseFloat(getComputedStyle(el).opacity))).toBeGreaterThan(0.9)
    }
    // The strict figure is visible in reduced mode too.
    await expect(page.getByTestId('strict-coverage')).toBeVisible()

    await sec.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    await sec.screenshot({ path: 'test-results/decisions-reduced-motion.png' })
  })
})
