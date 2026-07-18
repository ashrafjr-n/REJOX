import { test, expect } from '@playwright/test'

import showcase from '../src/data/showcase.json' with { type: 'json' }
import type { ShowcaseData } from '../src/types/showcase.generated'
import { computeLayout, LAYOUT_SEED } from '../src/screens/understandingLayout'

/**
 * The knowledge-graph layout must be DETERMINISTIC — the same build produces the
 * same picture every time — so the scrubbed morph has stable targets and the
 * committed screenshots don't drift. These are pure computations; no browser is
 * needed (the config still boots the web servers, but nothing here touches them).
 */

const data = showcase as ShowcaseData

test('node layout is identical across two independent computations', () => {
  const a = computeLayout(data, LAYOUT_SEED)
  const b = computeLayout(data, LAYOUT_SEED)

  // Independent runs — not the same memoized object — proving the algorithm is
  // free of Math.random / Date / unstable-sort nondeterminism.
  expect(a).not.toBe(b)
  expect(a.nodes).not.toBe(b.nodes)
  expect(a).toEqual(b)

  // The layout covers the whole real graph — every node and edge, positioned.
  expect(a.nodes).toHaveLength((data.graph.nodes ?? []).length)
  expect(a.edges).toHaveLength((data.graph.edges ?? []).length)
  for (const n of a.nodes) {
    expect(Number.isFinite(n.x)).toBe(true)
    expect(Number.isFinite(n.y)).toBe(true)
    expect(n.x).toBeGreaterThanOrEqual(0)
    expect(n.x).toBeLessThanOrEqual(a.width)
    expect(n.y).toBeGreaterThanOrEqual(0)
    expect(n.y).toBeLessThanOrEqual(a.height)
  }
})

test('layout matches the committed snapshot (regression guard)', () => {
  // Platform-independent (pure arithmetic), so this snapshot is safe to commit
  // and will catch any future change to the algorithm or the source data.
  const layout = computeLayout(data, LAYOUT_SEED)
  expect(JSON.stringify(layout, null, 2)).toMatchSnapshot('understanding-layout.json')
})
