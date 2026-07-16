import { chromium } from '@playwright/test'
const OUT = '/private/tmp/claude-501/-Users-ashrafjarabeah-Desktop-rejox/6e2e6173-c477-4859-ae67-6a01eec5251f/scratchpad'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(15000)
await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

// hide pillar + glow: isolate mouse-driven change to the border/mesh layer only
await page.evaluate(() => {
  const p = document.querySelector('.rx-pillar-fixed'); if (p) p.style.display = 'none'
  document.querySelectorAll('.rx-card > span').forEach((s) => { s.style.display = 'none' })
})
await page.waitForTimeout(200)

// tiny clip at DEAD CENTER (far from every edge/corner/ring) — pure background
const center = (b) => page.screenshot({ timeout: 12000, clip: {
  x: Math.round(b.x + b.width / 2 - 6), y: Math.round(b.y + b.height / 2 - 5), width: 12, height: 10 } })

for (const [name, sel] of [['LG', '.rx-card-lg'], ['SM', '.rx-card-sm']]) {
  const b = await page.locator(sel).first().boundingBox()
  await page.mouse.move(150, 500, { steps: 4 }); await page.waitForTimeout(200)
  const baseline = await center(b)
  const ends = [
    [b.x + b.width - 3, b.y + 3], [b.x + 3, b.y + b.height - 3],
    [b.x + b.width / 2, b.y + 2], [b.x + 3, b.y + b.height / 2],
    [b.x + b.width - 3, b.y + b.height - 3],
  ]
  let changed = 0
  for (let c = 0; c < 5; c++) {
    for (const [px, py] of ends) { await page.mouse.move(px, py, { steps: 3 }); await page.waitForTimeout(70) }
    await page.mouse.move(ends[c][0], ends[c][1], { steps: 2 }); await page.waitForTimeout(120)
    const s = await center(b)
    if (!s.equals(baseline)) changed++
    await page.mouse.move(150, 500, { steps: 3 }); await page.waitForTimeout(90)
  }
  console.log(`${name} DEAD-CENTER background static: ${5 - changed}/5 cycles identical -> ${changed === 0 ? 'STATIC ✓ (background never reacts)' : `*** ${changed}/5 changed ***`}`)
}
await browser.close()
console.log('center done')
