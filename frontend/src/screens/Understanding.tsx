import { useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

import './Understanding.css'
import showcase from '../data/showcase.json' with { type: 'json' }
import type { ShowcaseData } from '../types/showcase.generated'
import { graphLayout, WAVE_GEOM } from './understandingLayout'

/**
 * Scene 01 — "Understanding".
 *
 * One stage that TRANSFORMS across three beats, reusing the same node elements
 * throughout — the continuity is the point:
 *   Beat 1  raw source-file list.
 *   Beat 2  the files collapse into the project's knowledge graph.
 *   Beat 3  the graph reorganizes into the engine's own topological build waves
 *           (W1…W9) — same knowledge, reordered by what must be built first.
 *
 * Every datum comes from `showcase.json` via the generated type; every position
 * from `understandingLayout` (deterministic, computed once). Nothing — not even
 * the LLM count — is a hard-coded figure: the understanding-phase LLM total is
 * summed from the exporter's real per-phase counts.
 *
 * Mechanics: one pinned, scrubbed GSAP timeline drives the whole morph on
 * transform / opacity / stroke-dashoffset only, straight on the SVG (no
 * per-frame React). The readout swaps its beat-specific figures via CSS keyed to
 * the section's `data-beat` (set imperatively — no re-render). Cleanup uses
 * gsap.context().revert(). Reduced motion renders the settled build-order
 * arrangement with the file list and the full readout — nothing behind scroll.
 *
 * Desktop only.
 */

gsap.registerPlugin(ScrollTrigger)

const BEAT_COUNT = 3
const BEATS_IN_VIEWPORTS = BEAT_COUNT

const data = showcase as ShowcaseData
const { nodes, edges, fileRows, width, height, filesWithoutNode, waveColumns } = graphLayout

// --- Derived, data-backed figures (no literal counts anywhere) --------------
const sourceFileCount = (data.project.sourceFiles ?? []).length
const nodeCount = nodes.length
const edgeCount = edges.length
const edgeKindCounts = (data.graph.edges ?? []).reduce<Record<string, number>>((m, e) => {
  m[e.kind] = (m[e.kind] ?? 0) + 1
  return m
}, {})
const edgeKindBreakdown = Object.entries(edgeKindCounts).sort((a, b) => b[1] - a[1])
const edgeKindCount = edgeKindBreakdown.length
const planStepCount = (data.waves ?? []).length
const waveCount = waveColumns.length

// The understanding-phase LLM total: summed from the exporter's MEASURED
// per-phase counts (the deterministic reading phases), never a constant. Phase
// names are labels, not figures.
const UNDERSTANDING_PHASES = new Set(['intelligence', 'analyze', 'plan'])
const understandingLlmCalls = (data.results.llmCallsByPhase ?? [])
  .filter((p) => UNDERSTANDING_PHASES.has(p.phase))
  .reduce((sum, p) => sum + p.calls, 0)

// --- Edge kinds distinguished by stroke WEIGHT + OPACITY only (monochrome). ---
const EDGE_STYLE: Record<string, { w: number; o: number }> = {
  imports: { w: 0.7, o: 0.16 },
  renders: { w: 1.0, o: 0.32 },
  'uses-store': { w: 1.5, o: 0.6 },
  'uses-hook': { w: 1.7, o: 0.78 },
  'calls-api': { w: 2.2, o: 0.95 },
}
const edgeStyle = (kind: string) => EDGE_STYLE[kind] ?? EDGE_STYLE.imports
const nodeRadius = (degree: number) => 3 + Math.min(degree, 6) * 0.55
const isEntity = (id: string) => id.includes('#')

// Build-order dependency edges: only those whose BOTH endpoints are build units
// (in a wave). Edges touching a periphery node fade rather than stretch to it.
const nodeById = new Map(nodes.map((n) => [n.id, n]))
const waveEdges = edges
  .filter((e) => nodeById.get(e.from)?.wave != null && nodeById.get(e.to)?.wave != null)
  .map((e) => {
    const a = nodeById.get(e.from)!
    const b = nodeById.get(e.to)!
    return { x1: a.waveX, y1: a.waveY, x2: b.waveX, y2: b.waveY, kind: e.kind }
  })

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export default function Understanding() {
  const sectionRef = useRef<HTMLElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [reduced] = useState(prefersReducedMotion)
  const [pinned, setPinned] = useState(false)

  useLayoutEffect(() => {
    if (reduced) return
    const section = sectionRef.current
    const svg = svgRef.current
    if (!section || !svg) return

    const nodeEls = gsap.utils.toArray<SVGGElement>(svg.querySelectorAll('.rx-u-node'))
    const graphEdgeEls = gsap.utils.toArray<SVGLineElement>(svg.querySelectorAll('.rx-u-edge'))
    const waveEdgeEls = gsap.utils.toArray<SVGLineElement>(svg.querySelectorAll('.rx-u-wave-edge'))
    const fileEls = gsap.utils.toArray<SVGTextElement>(svg.querySelectorAll('.rx-u-file'))
    const waveColEls = gsap.utils.toArray<SVGGElement>(svg.querySelectorAll('.rx-u-wave-col'))
    const nodeOf = new Map(nodeEls.map((el, i) => [el, nodes[i]]))

    const ctx = gsap.context(() => {
      // Resting (Beat 1): nodes collapsed onto their file origin; wave scaffolding
      // and edges hidden.
      nodeEls.forEach((el, i) => {
        const n = nodes[i]
        gsap.set(el, { opacity: 0, scale: 0.2, x: n.originX - n.x, y: n.originY - n.y })
      })
      gsap.set(graphEdgeEls, { strokeDashoffset: 1 })
      gsap.set(waveEdgeEls, { strokeDashoffset: 1 })
      gsap.set(waveColEls, { opacity: 0 })

      const tl = gsap.timeline({ defaults: { ease: 'none' } })

      // --- Beat 1 → 2: files collapse into nodes; edges draw. Timed so the
      //     graph is fully SETTLED across the middle third (beat 1), well before
      //     the wave migration begins. ---
      fileEls.forEach((el, i) => {
        const f = fileRows[i]
        const target = f.hasNode ? nodeById.get(f.path) : undefined
        tl.to(
          el,
          { opacity: 0, x: target ? target.x - f.x : 0, y: target ? target.y - f.y : 0, duration: 0.16 },
          0.28,
        )
      })
      tl.to(nodeEls, { opacity: 1, scale: 1, x: 0, y: 0, duration: 0.18, stagger: 0.003 }, 0.3)
      tl.to(graphEdgeEls, { strokeDashoffset: 0, duration: 0.12, stagger: 0.0008 }, 0.4)

      // --- Beat 2 → 3: the SAME nodes migrate into wave columns (build units) or
      //     settle to a dim periphery (context). Graph edges fade; the build-order
      //     dependency edges draw in; the W1…W9 labels appear. Everything finishes
      //     by ~0.95 so beat 3 has a settled hold. ---
      const buildEls = nodeEls.filter((el) => nodeOf.get(el)!.wave != null)
      const orphanEls = nodeEls.filter((el) => nodeOf.get(el)!.wave == null)
      const dx = (el: SVGGElement) => nodeOf.get(el)!.waveX - nodeOf.get(el)!.x
      const dy = (el: SVGGElement) => nodeOf.get(el)!.waveY - nodeOf.get(el)!.y

      tl.to(graphEdgeEls, { opacity: 0, duration: 0.08 }, 0.68)
      tl.to(buildEls, { x: (_i, el) => dx(el), y: (_i, el) => dy(el), duration: 0.18, stagger: 0.002 }, 0.68)
      tl.to(
        orphanEls,
        { x: (_i, el) => dx(el), y: (_i, el) => dy(el), opacity: 0.28, scale: 0.7, duration: 0.18 },
        0.68,
      )
      tl.to(waveColEls, { opacity: 1, duration: 0.12, stagger: 0.006 }, 0.7)
      tl.to(waveEdgeEls, { strokeDashoffset: 0, duration: 0.11, stagger: 0.001 }, 0.8)

      const st = ScrollTrigger.create({
        trigger: section,
        start: 'top top',
        end: () => '+=' + window.innerHeight * BEATS_IN_VIEWPORTS,
        pin: true,
        pinSpacing: true,
        scrub: true,
        animation: tl,
        onToggle: (self) => setPinned(self.isActive),
        onUpdate: (self) => {
          const beat = Math.min(BEAT_COUNT - 1, Math.floor(self.progress * BEAT_COUNT))
          section.dataset.beat = String(beat)
          section.dataset.progress = self.progress.toFixed(4)
        },
      })
      section.dataset.beat = '0'
      section.dataset.progress = '0.0000'
      void st
    }, section)

    return () => ctx.revert()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced])

  useLayoutEffect(() => {
    const section = sectionRef.current
    if (section) section.dataset.pinned = pinned ? 'true' : 'false'
  }, [pinned])

  // In reduced motion the nodes rest at their WAVE positions (the build-order
  // payoff); in motion mode they rest at graph positions and GSAP moves them.
  const anchorXY = (nodeIndex: number): [number, number] =>
    reduced ? [nodes[nodeIndex].waveX, nodes[nodeIndex].waveY] : [nodes[nodeIndex].x, nodes[nodeIndex].y]

  return (
    <section
      ref={sectionRef}
      className={'rx-understanding' + (reduced ? ' is-reduced' : '')}
      aria-label="Scene 01 — Understanding"
      data-rx-understanding=""
      data-pinned="false"
      data-beat="0"
      data-reduced={reduced ? 'true' : 'false'}
    >
      <div className="rx-understanding-inner">
        <div className="rx-eyebrow rx-u-eyebrow">
          <span className="rx-rule" />
          <span className="rx-label">Scene 01 · Understanding</span>
        </div>

        <h2 className="rx-u-heading">
          Rejox <span className="rx-u-accent">reads</span> your project before it
          touches it.
        </h2>

        {reduced && (
          <ul className="rx-u-filelist" aria-label="Source files">
            {fileRows.map((f) => (
              <li key={f.path} className={f.hasNode ? '' : 'is-orphan'}>
                {f.path}
              </li>
            ))}
          </ul>
        )}

        <div className="rx-u-stage-wrap">
          <svg
            ref={svgRef}
            className="rx-u-stage"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="Source files collapsing into the knowledge graph, then reordered into build waves"
          >
            {/* Wave columns (Beat 3): guide line + W-index + step kinds. */}
            <g className="rx-u-waves">
              {waveColumns.map((c) => (
                <g key={c.wave} className="rx-u-wave-col">
                  <line
                    className="rx-u-wave-col-line"
                    x1={c.x}
                    y1={WAVE_GEOM.lineTop}
                    x2={c.x}
                    y2={WAVE_GEOM.lineBottom}
                  />
                  <text className="rx-u-wave-col-label" x={c.x} y={WAVE_GEOM.labelY}>
                    {c.label}
                  </text>
                  <text className="rx-u-wave-col-kind" x={c.x} y={WAVE_GEOM.kindY}>
                    {c.kinds.join(' · ')}
                  </text>
                </g>
              ))}
            </g>

            {/* Beat-2 graph edges (fade out in Beat 3). */}
            <g className="rx-u-edges">
              {edges.map((e, i) => {
                const s = edgeStyle(e.kind)
                return (
                  <line
                    key={i}
                    className="rx-u-edge"
                    x1={e.x1}
                    y1={e.y1}
                    x2={e.x2}
                    y2={e.y2}
                    strokeWidth={s.w}
                    strokeOpacity={s.o}
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={reduced ? 0 : 1}
                    style={reduced ? { opacity: 0 } : undefined}
                  />
                )
              })}
            </g>

            {/* Beat-3 build-order dependency edges (drawn in Beat 3). */}
            <g className="rx-u-wave-edges">
              {waveEdges.map((e, i) => {
                const s = edgeStyle(e.kind)
                return (
                  <line
                    key={i}
                    className="rx-u-wave-edge"
                    x1={e.x1}
                    y1={e.y1}
                    x2={e.x2}
                    y2={e.y2}
                    strokeWidth={s.w}
                    strokeOpacity={s.o}
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={reduced ? 0 : 1}
                  />
                )
              })}
            </g>

            {/* Nodes — the same elements across all three beats. */}
            <g className="rx-u-nodes">
              {nodes.map((n, i) => {
                const [ax, ay] = anchorXY(i)
                return (
                  <g key={n.id} transform={`translate(${ax} ${ay})`}>
                    <g
                      className={
                        'rx-u-node' +
                        (isEntity(n.id) ? ' is-entity' : '') +
                        (n.wave == null ? ' is-orphan' : '')
                      }
                      data-node-index={i}
                    >
                      <circle cx={0} cy={0} r={nodeRadius(n.degree)} />
                    </g>
                  </g>
                )
              })}
            </g>

            {!reduced && (
              <g className="rx-u-files">
                {fileRows.map((f) => (
                  <text
                    key={f.path}
                    className={'rx-u-file' + (f.hasNode ? '' : ' is-orphan')}
                    x={f.x}
                    y={f.y}
                  >
                    {f.path}
                  </text>
                ))}
              </g>
            )}
          </svg>
        </div>

        {/* Readout — beat-specific figures swap quietly; the LLM metric is
            always present. */}
        <dl className="rx-u-readout">
          <div className="rx-u-readout-beats">
            {/* Beat 1 — file-level figures + the honest note. */}
            <div className="rx-u-rgroup" data-group="0">
              <div className="rx-u-metric">
                <dt className="rx-u-metric-value tnum">{sourceFileCount}</dt>
                <dd className="rx-u-metric-label">Source files</dd>
              </div>
              <p className="rx-u-readout-note">
                <span className="tnum">{filesWithoutNode}</span> of{' '}
                <span className="tnum">{fileRows.length}</span> are config / assets
                outside the dependency graph — they fade rather than become nodes.
              </p>
            </div>

            {/* Beat 2 — graph figures + edge-kind breakdown. */}
            <div className="rx-u-rgroup" data-group="1">
              <div className="rx-u-metric">
                <dt className="rx-u-metric-value tnum">{nodeCount}</dt>
                <dd className="rx-u-metric-label">Nodes</dd>
              </div>
              <div className="rx-u-metric">
                <dt className="rx-u-metric-value tnum">{edgeCount}</dt>
                <dd className="rx-u-metric-label">Edges</dd>
              </div>
              <div className="rx-u-metric">
                <dt className="rx-u-metric-value tnum">{edgeKindCount}</dt>
                <dd className="rx-u-metric-label">Edge kinds</dd>
              </div>
              <div className="rx-u-kindrow">
                {edgeKindBreakdown.map(([kind, count]) => (
                  <span key={kind}>
                    {kind} <span className="tnum">{count}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* Beat 3 — plan figures. */}
            <div className="rx-u-rgroup" data-group="2">
              <div className="rx-u-metric">
                <dt className="rx-u-metric-value tnum">{planStepCount}</dt>
                <dd className="rx-u-metric-label">Plan steps</dd>
              </div>
              <div className="rx-u-metric">
                <dt className="rx-u-metric-value tnum">{waveCount}</dt>
                <dd className="rx-u-metric-label">Build waves</dd>
              </div>
              <p className="rx-u-readout-note">
                <span className="tnum">{graphLayout.nodesInWaves}</span> nodes are
                build units placed in a wave;{' '}
                <span className="tnum">{graphLayout.nodesOutsideWaves}</span> are import
                structure, settled aside.
              </p>
            </div>
          </div>

          {/* Always visible — the understanding phase's real LLM count. */}
          <div className="rx-u-metric rx-u-llm">
            <dt className="rx-u-metric-value tnum">{understandingLlmCalls}</dt>
            <dd className="rx-u-metric-label">LLM calls</dd>
          </div>
        </dl>

        <p className="rx-u-attribution">
          Real figures from an actual Rejox pipeline run on the benchmark project
          (<span className="tnum">{data.project.name}</span>).
        </p>
      </div>
    </section>
  )
}
