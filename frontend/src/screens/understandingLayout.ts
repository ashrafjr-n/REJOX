/**
 * Deterministic layout for the Understanding scene's knowledge graph.
 *
 * The scene morphs a raw source-file list (Beat 1) into the project's knowledge
 * graph (Beat 2). This module owns the GEOMETRY — computed once, from the graph
 * data, with a fully deterministic algorithm. The same input always produces the
 * same picture (a test proves it), so the scrubbed animation has stable targets
 * and nothing is ever laid out per frame.
 *
 * Algorithm — file-locality-seeded force relaxation:
 *   1. Lay the source files out as a readable multi-column list (Beat 1). Each
 *      file gets a text position on the stage.
 *   2. Seed every graph node at ITS source file's text position (+ a small
 *      seeded jitter for the several nodes that share one file). This is what
 *      makes the collapse read as causal: a node originates where its file's
 *      text sits, so the text visibly collapses INTO it.
 *   3. Relax with a fixed number of Fruchterman-Reingold iterations (repulsion
 *      + edge attraction + a weak anchor back to the seed, which both preserves
 *      file locality and stops the graph's two disconnected components — the
 *      file-import graph and the component-render graph — from drifting apart).
 *   4. Normalize the settled bounding box to fill the stage. Normalization (not
 *      clamping) is what guarantees the picture fills the frame regardless of the
 *      physics' absolute scale, and places the two components in two regions.
 *
 * Determinism: the ONLY entropy is `mulberry32(seed)`; every other step is plain
 * arithmetic over the data in a stable order. No Math.random, no Date, no
 * unstable sort. `computeLayout` does not memoize — callers that want a singleton
 * memoize the export below; the test calls it twice from scratch and deep-equals.
 */

import showcase from '../data/showcase.json' with { type: 'json' }
import type { ShowcaseData } from '../types/showcase.generated'

// --- Stage geometry (SVG user units; the SVG scales to its container) --------
export const STAGE_WIDTH = 1120
export const STAGE_HEIGHT = 470
export const LAYOUT_SEED = 0x9e3779b9

// Wave-column header geometry (Beat 3). Kept here — the geometry module — so the
// component carries no coordinate literals of its own.
export const WAVE_GEOM = {
  labelY: 26,
  kindY: 42,
  lineTop: 58,
  lineBottom: STAGE_HEIGHT - 44,
} as const

// File-list (Beat 1) column grid.
const FILE_COLUMNS = 3
const LIST_PAD_X = 8
const LIST_PAD_Y = 10
const ROW_HEIGHT = 30

// Force relaxation.
const ITERATIONS = 500
const GRAPH_PAD = 46 // inset of the normalized graph from the stage edges

export interface LaidOutNode {
  id: string
  label: string
  kind: string
  sourceFile: string
  /** Final graph position. */
  x: number
  y: number
  /** Where this node's file text sits in the Beat-1 list — its collapse origin. */
  originX: number
  originY: number
  degree: number
  /** The build wave this node belongs to — the MIN wave index among plan steps
   *  whose targets literally include this node's id. `null` when the node is not
   *  a target of any step (import-structure context, not a build unit): the UI
   *  settles those to a dim periphery, never into a wave they don't belong to. */
  wave: number | null
  /** Beat-3 target position: a slot in its wave column, or a periphery slot. */
  waveX: number
  waveY: number
}

export interface LaidOutEdge {
  from: string
  to: string
  kind: string
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface FileRow {
  path: string
  x: number
  y: number
  /** True when this file became one or more graph nodes; false for config /
   *  asset files that are not part of the dependency graph (they fade, honestly,
   *  rather than collapsing into a node that doesn't exist). */
  hasNode: boolean
}

export interface WaveColumn {
  /** Engine wave index (0-based). */
  wave: number
  /** Display label from the index — "W1"…"W9". */
  label: string
  /** The step kinds the engine placed in this wave (e.g. ["setup"]) — shown as
   *  a sublabel so an empty column truthfully reads "this wave builds scaffold /
   *  validation, not graph nodes" rather than looking broken. */
  kinds: string[]
  /** Column centre x. */
  x: number
  /** How many graph nodes land in this column. */
  nodeCount: number
}

export interface GraphLayout {
  nodes: LaidOutNode[]
  edges: LaidOutEdge[]
  fileRows: FileRow[]
  width: number
  height: number
  /** Count of files with no node — surfaced in the UI, never hidden. */
  filesWithoutNode: number
  /** Every engine wave, W1…W9, in order (some hold no graph nodes). */
  waveColumns: WaveColumn[]
  /** Nodes that are build units (placed in a wave) vs. import-structure context. */
  nodesInWaves: number
  nodesOutsideWaves: number
}

// --- Seeded PRNG (deterministic) --------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Pt {
  x: number
  y: number
}

/** Beat-1 list position for a file at list index `i`. Column-major so reading
 *  order flows down each column. */
function fileRowPosition(i: number, total: number): Pt {
  const perColumn = Math.ceil(total / FILE_COLUMNS)
  const col = Math.floor(i / perColumn)
  const row = i % perColumn
  const colWidth = STAGE_WIDTH / FILE_COLUMNS
  return {
    x: col * colWidth + LIST_PAD_X,
    y: LIST_PAD_Y + row * ROW_HEIGHT + ROW_HEIGHT / 2,
  }
}

export function computeLayout(data: ShowcaseData, seed: number = LAYOUT_SEED): GraphLayout {
  const rand = mulberry32(seed)
  const sourceFiles = data.project.sourceFiles ?? []
  const rawNodes = data.graph.nodes ?? []
  const rawEdges = data.graph.edges ?? []

  // 1. File list positions, keyed by path (stable input order).
  const filePos = new Map<string, Pt>()
  sourceFiles.forEach((path, i) => filePos.set(path, fileRowPosition(i, sourceFiles.length)))

  // 2. Seed node positions at their source file's text position (+ jitter).
  //    Nodes are processed in their stable data order so the jitter draws are
  //    reproducible. A node whose sourceFile isn't in the list (shouldn't
  //    happen) falls back to the stage centre.
  const pos: Pt[] = []
  const idIndex = new Map<string, number>()
  rawNodes.forEach((n, i) => {
    idIndex.set(n.id, i)
    const origin = filePos.get(n.sourceFile) ?? { x: STAGE_WIDTH / 2, y: STAGE_HEIGHT / 2 }
    // Jitter keeps co-located nodes (a file node + its component entity node)
    // from starting exactly on top of each other, so repulsion can separate them.
    pos.push({
      x: origin.x + (rand() - 0.5) * 24,
      y: origin.y + (rand() - 0.5) * 24,
    })
  })

  // Seed positions are also the collapse origins — snapshot them before physics.
  const seedPos: Pt[] = pos.map((p) => ({ x: p.x, y: p.y }))

  // Edge list as index pairs (skip any endpoint not present, though the export
  // guarantees none dangle).
  const edgePairs: Array<{ a: number; b: number; from: string; to: string; kind: string }> = []
  for (const e of rawEdges) {
    const a = idIndex.get(e.from)
    const b = idIndex.get(e.to)
    if (a !== undefined && b !== undefined) edgePairs.push({ a, b, from: e.from, to: e.to, kind: e.kind })
  }

  // 3. Fruchterman-Reingold relaxation with a weak anchor to the seed.
  const n = rawNodes.length
  const area = STAGE_WIDTH * STAGE_HEIGHT
  const k = 0.75 * Math.sqrt(area / Math.max(n, 1)) // ideal edge length
  const anchor = 0.015 // weak spring back to the file-locality seed
  let temp = STAGE_WIDTH / 10

  const disp: Pt[] = pos.map(() => ({ x: 0, y: 0 }))
  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (let i = 0; i < n; i++) {
      disp[i].x = 0
      disp[i].y = 0
    }
    // Repulsion — every ordered pair, in index order (deterministic).
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x
        let dy = pos[i].y - pos[j].y
        let dist = Math.hypot(dx, dy)
        if (dist < 0.01) {
          // Deterministic nudge (no random) when two nodes coincide.
          dx = (i - j) * 0.01
          dy = 0.01
          dist = Math.hypot(dx, dy)
        }
        const rep = (k * k) / dist
        const ux = dx / dist
        const uy = dy / dist
        disp[i].x += ux * rep
        disp[i].y += uy * rep
        disp[j].x -= ux * rep
        disp[j].y -= uy * rep
      }
    }
    // Attraction along edges.
    for (const { a, b } of edgePairs) {
      let dx = pos[a].x - pos[b].x
      let dy = pos[a].y - pos[b].y
      let dist = Math.hypot(dx, dy)
      if (dist < 0.01) dist = 0.01
      const att = (dist * dist) / k
      const ux = dx / dist
      const uy = dy / dist
      disp[a].x -= ux * att
      disp[a].y -= uy * att
      disp[b].x += ux * att
      disp[b].y += uy * att
    }
    // Weak anchor to seed (locality + anti-drift).
    for (let i = 0; i < n; i++) {
      disp[i].x += (seedPos[i].x - pos[i].x) * anchor * k
      disp[i].y += (seedPos[i].y - pos[i].y) * anchor * k
    }
    // Integrate, capped by temperature.
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(disp[i].x, disp[i].y)
      if (d > 0.01) {
        const capped = Math.min(d, temp)
        pos[i].x += (disp[i].x / d) * capped
        pos[i].y += (disp[i].y / d) * capped
      }
    }
    temp *= 0.985 // linear-ish cooling
  }

  // 4. Normalize the settled bounding box to fill the stage (with padding).
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pos) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const spanX = maxX - minX || 1
  const spanY = maxY - minY || 1
  const usableW = STAGE_WIDTH - 2 * GRAPH_PAD
  const usableH = STAGE_HEIGHT - 2 * GRAPH_PAD
  const norm = (p: Pt): Pt => ({
    x: GRAPH_PAD + ((p.x - minX) / spanX) * usableW,
    y: GRAPH_PAD + ((p.y - minY) / spanY) * usableH,
  })
  const finalPos = pos.map(norm)

  // Degrees (for hub emphasis).
  const degree = new Array(n).fill(0)
  for (const { a, b } of edgePairs) {
    degree[a]++
    degree[b]++
  }

  // Round to keep the serialized layout compact and the determinism test crisp.
  const r = (v: number): number => Math.round(v * 100) / 100

  // --- Beat 3: build-order waves ---------------------------------------------
  // A node belongs to the MIN wave whose plan-step targets literally include its
  // id. We never infer membership via sourceFile — that would place a node in a
  // wave the plan never assigned it to. Nodes with no target membership are
  // import-structure context, settled to a dim periphery (not a wave).
  const planSteps = data.waves ?? []
  const targetMinWave = new Map<string, number>()
  for (const step of planSteps) {
    for (const t of step.targets ?? []) {
      const prev = targetMinWave.get(t)
      if (prev === undefined || step.wave < prev) targetMinWave.set(t, step.wave)
    }
  }
  const nodeWave: (number | null)[] = rawNodes.map((nd) => {
    const w = targetMinWave.get(nd.id)
    return w === undefined ? null : w
  })

  // Wave columns: every wave index the engine used, in order, with its kinds.
  const waveIndices = [...new Set(planSteps.map((s) => s.wave))].sort((x, y) => x - y)
  const waveKinds = new Map<number, string[]>()
  for (const s of planSteps) {
    const arr = waveKinds.get(s.wave) ?? []
    if (!arr.includes(s.kind)) arr.push(s.kind)
    waveKinds.set(s.wave, arr)
  }
  const colUsableW = STAGE_WIDTH - 2 * GRAPH_PAD
  const colWidth = colUsableW / Math.max(waveIndices.length, 1)
  const colXByPos = (idx: number): number => GRAPH_PAD + (idx + 0.5) * colWidth
  const colPosOfWave = new Map<number, number>()
  waveIndices.forEach((w, idx) => colPosOfWave.set(w, idx))

  // Stack build nodes vertically within their column (deterministic order).
  const WAVE_TOP = 66
  const WAVE_BOTTOM = STAGE_HEIGHT - 58
  const byWave = new Map<number, number[]>()
  rawNodes.forEach((_, i) => {
    const w = nodeWave[i]
    if (w !== null) (byWave.get(w) ?? byWave.set(w, []).get(w)!).push(i)
  })
  const wavePos: Pt[] = rawNodes.map(() => ({ x: 0, y: 0 }))
  for (const [w, idxs] of byWave) {
    idxs.sort((a, b) => degree[b] - degree[a] || (rawNodes[a].id < rawNodes[b].id ? -1 : 1))
    const cx = colXByPos(colPosOfWave.get(w)!)
    const count = idxs.length
    const gap = count > 1 ? Math.min(28, (WAVE_BOTTOM - WAVE_TOP) / (count - 1)) : 0
    const startY = (WAVE_TOP + WAVE_BOTTOM) / 2 - (gap * (count - 1)) / 2
    idxs.forEach((ni, k) => {
      wavePos[ni] = { x: cx, y: startY + k * gap }
    })
  }
  // Orphans → a dim periphery band along the bottom, spread by id order.
  const orphans = rawNodes.map((_, i) => i).filter((i) => nodeWave[i] === null)
  orphans.sort((a, b) => (rawNodes[a].id < rawNodes[b].id ? -1 : 1))
  orphans.forEach((ni, k) => {
    const t = orphans.length > 1 ? k / (orphans.length - 1) : 0.5
    wavePos[ni] = { x: GRAPH_PAD + t * colUsableW, y: STAGE_HEIGHT - 22 }
  })

  const waveColumns: WaveColumn[] = waveIndices.map((w, idx) => ({
    wave: w,
    label: 'W' + (w + 1),
    kinds: waveKinds.get(w) ?? [],
    x: r(colXByPos(idx)),
    nodeCount: (byWave.get(w) ?? []).length,
  }))

  const nodes: LaidOutNode[] = rawNodes.map((nd, i) => ({
    id: nd.id,
    label: nd.label,
    kind: nd.kind,
    sourceFile: nd.sourceFile,
    x: r(finalPos[i].x),
    y: r(finalPos[i].y),
    originX: r(seedPos[i].x),
    originY: r(seedPos[i].y),
    degree: degree[i],
    wave: nodeWave[i],
    waveX: r(wavePos[i].x),
    waveY: r(wavePos[i].y),
  }))

  const edges: LaidOutEdge[] = edgePairs.map(({ a, b, from, to, kind }) => ({
    from,
    to,
    kind,
    x1: r(finalPos[a].x),
    y1: r(finalPos[a].y),
    x2: r(finalPos[b].x),
    y2: r(finalPos[b].y),
  }))

  const nodeSourceFiles = new Set(rawNodes.map((nd) => nd.sourceFile))
  const fileRows: FileRow[] = sourceFiles.map((path) => {
    const p = filePos.get(path)!
    return { path, x: r(p.x), y: r(p.y), hasNode: nodeSourceFiles.has(path) }
  })
  const filesWithoutNode = fileRows.filter((f) => !f.hasNode).length
  const nodesInWaves = nodeWave.filter((w) => w !== null).length

  return {
    nodes,
    edges,
    fileRows,
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    filesWithoutNode,
    waveColumns,
    nodesInWaves,
    nodesOutsideWaves: rawNodes.length - nodesInWaves,
  }
}

// App singleton — memoized once from the committed showcase data.
export const graphLayout: GraphLayout = computeLayout(showcase as ShowcaseData)
