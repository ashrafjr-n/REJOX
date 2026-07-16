import { chromium } from '@playwright/test'
const OUT = '/private/tmp/claude-501/-Users-ashrafjarabeah-Desktop-rejox/6e2e6173-c477-4859-ae67-6a01eec5251f/scratchpad'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(20000)
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1600)

const setHidden = (h) => page.evaluate((hide) => {
  const p = document.querySelector('.rx-pillar-fixed'); if (p) p.style.display = hide ? 'none' : ''
  document.querySelectorAll('.rx-card > span').forEach((s) => { s.style.display = hide ? 'none' : '' })
}, h)

// ---------- background-static test (pillar+glow hidden) ----------
await setHidden(true); await page.waitForTimeout(250)
const center = (b) => page.screenshot({ timeout: 15000, clip: {
  x: Math.round(b.x + b.width / 2 - 6), y: Math.round(b.y + b.height / 2 - 5), width: 12, height: 10 } })
const results = {}
for (const [name, sel] of [['LG', '.rx-card-lg'], ['SM', '.rx-card-sm']]) {
  const b = await page.locator(sel).first().boundingBox()
  await page.mouse.move(150, 500, { steps: 4 }); await page.waitForTimeout(200)
  const baseline = await center(b)
  const ends = [[b.x + b.width - 3, b.y + 3], [b.x + 3, b.y + b.height - 3], [b.x + b.width / 2, b.y + 2], [b.x + 3, b.y + b.height / 2], [b.x + b.width - 3, b.y + b.height - 3]]
  let changed = 0
  for (let c = 0; c < 5; c++) {
    for (const [px, py] of ends) { await page.mouse.move(px, py, { steps: 3 }); await page.waitForTimeout(60) }
    await page.waitForTimeout(100)
    if (!(await center(b)).equals(baseline)) changed++
    await page.mouse.move(150, 500, { steps: 3 }); await page.waitForTimeout(80)
  }
  results[name] = `${5 - changed}/5 identical -> ${changed === 0 ? 'STATIC ✓' : `*** ${changed}/5 CHANGED ***`}`
}
console.log('DEAD-CENTER background:', JSON.stringify(results))

// ---------- final visuals (glow + pillar ON) ----------
await setHidden(false); await page.waitForTimeout(400)
const bb = await page.locator('.rx-card-lg').boundingBox()
await page.mouse.move(bb.x + bb.width - 6, bb.y + 7, { steps: 8 }); await page.waitForTimeout(500)
await page.locator('.rx-cards').screenshot({ path: `${OUT}/final-lg-edge.png` })
const sb = await page.locator('.rx-card-sm').boundingBox()
await page.mouse.move(sb.x + 8, sb.y + sb.height - 6, { steps: 8 }); await page.waitForTimeout(500)
await page.locator('.rx-cards').screenshot({ path: `${OUT}/final-sm-edge.png` })
// rest (mouse away)
await page.mouse.move(150, 500, { steps: 4 }); await page.waitForTimeout(500)
await page.locator('.rx-cards').screenshot({ path: `${OUT}/final-rest.png` })
await browser.close()
console.log('final done')
