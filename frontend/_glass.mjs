import { chromium } from '@playwright/test'
const OUT = '/private/tmp/claude-501/-Users-ashrafjarabeah-Desktop-rejox/6e2e6173-c477-4859-ae67-6a01eec5251f/scratchpad'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(20000)
await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded' })

// Wait for a VERY stable Stage 1: overlay absent AND the card title is laid out.
let ok = 0
for (let i = 0; i < 500; i++) {
  const st = await page.evaluate(() => {
    const overlay = document.querySelector('.rx-seq-overlay')
    const title = document.querySelector('.rx-card-title')
    const tb = title ? title.getBoundingClientRect() : null
    return { noOverlay: !overlay, titleShown: !!tb && tb.height > 0 && tb.width > 0, titleText: title?.textContent }
  })
  ok = (st.noOverlay && st.titleShown) ? ok + 1 : 0
  if (ok >= 6) break
  await page.waitForTimeout(50)
}
await page.waitForTimeout(150)

const diag = await page.evaluate(() => {
  const lg = document.querySelector('.rx-card-lg')
  const title = document.querySelector('.rx-card-title')
  const chip = document.querySelector('.rx-card-chip')
  const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
  return {
    overlayPresent: !!document.querySelector('.rx-seq-overlay'),
    cardRect: rect(lg), titleRect: rect(title), titleText: title?.textContent, chipRect: rect(chip),
    titleColor: title ? getComputedStyle(title).color : null,
    titleOpacity: title ? getComputedStyle(title).opacity : null,
  }
})
console.log('DIAG:', JSON.stringify(diag))

await page.screenshot({ path: `${OUT}/glass-fullhero.png` })
if (diag.cardRect) {
  const c = diag.cardRect
  await page.screenshot({ path: `${OUT}/glass-card.png`, clip: { x: c.x - 10, y: c.y - 10, width: c.w + 20, height: c.h + 20 } })
}
await browser.close()
console.log('glass done')
