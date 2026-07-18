import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import {
  Upload,
  Network,
  ListChecks,
  MessageCircleQuestion,
  RefreshCw,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'

import './Home.css'
import BorderGlow from './BorderGlow'
import LightPillar from './LightPillar'
import ScrollReveal from './ScrollReveal'
import rejoxLogo from '../assets/rejox-logo.svg'

gsap.registerPlugin(ScrollTrigger)

/**
 * Rejox marketing home — a static hero followed by a normal Section 02.
 *
 * The page scrolls naturally: the hero occupies one viewport and Section 02
 * flows directly below it in ordinary document order. There is no pinning, no
 * scroll-hijacking, and no scroll-driven color inversion — the earlier
 * scroll-triggered state machine and its GSAP timelines have been removed.
 *
 * The background is a WebGL "light pillar" (see LightPillar) rendered on a
 * `position: fixed`, full-viewport, `pointer-events: none` layer at the
 * `.rx-home` level (z-index 0, below the frame at z1 and the fixed header at
 * z50) with `screen` blend over the page's black base. Because it's one fixed
 * layer spanning the whole viewport — not clipped to the hero — there is no
 * seam where the hero meets Section 02: as the page scrolls the shader
 * *settles* (rotation slows, intensity fades, glow tightens; see
 * LightPillar's `scrollSettle`) and resolves to flat black by the time
 * Section 02 fills the screen, so the animated hero background reads as one
 * continuous visual that calms into Section 02's dark background rather than
 * cutting off. At scrollY 0 the resting hero is unchanged. It degrades to a
 * fallback note where WebGL is unavailable. The only other motion is a
 * one-shot entrance fade/slide on mount (framer-motion), independent of scroll.
 *
 * The header is a fixed sibling of the hero and Section 02 (not nested in
 * either), so it stays visible across the whole page. Everything is scoped
 * under `.rx-home`; the /app workflow is untouched.
 */

const NAV_ITEMS = ['Home', 'About', 'Docs', 'Features']

function ArrowRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/* Small inline icons for the hero cards (24-grid, stroked to match the site's
   icon set in components/icons.tsx). Kept local to the hero. */
function ChipBase({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/* CPU / chip with a spark — "intelligent, AST-precise" migration. */
function ChipIcon() {
  return (
    <ChipBase>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M10 3v2M14 3v2M10 19v2M14 19v2M3 10h2M3 14h2M19 10h2M19 14h2" />
      <path d="M12 10.5 11 13h2l-1 2.5" />
    </ChipBase>
  )
}

/* Lightning bolt — speed / production-ready output. */
function BoltIcon() {
  return (
    <ChipBase>
      <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z" />
    </ChipBase>
  )
}

/* ============================================================================
 * Project Intelligence — the full-viewport intro moment ("Upload your React
 * project…"). A standalone text-only section whose headline + paragraph reveal
 * word-by-word via ScrollReveal as it scrolls into view. (The former live
 * terminal / analysis-dashboard scene that used to sit below this intro has
 * been removed.)
 * ==========================================================================*/

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return reduced
}

function ProjectIntelligence() {
  return (
    <>
      {/* Standalone full-viewport intro — the "Project Intelligence" moment,
          scrolled FIRST, before the live-analysis (terminal/tree/dashboard)
          section below. Background is left transparent so the page's pure-black
          base shows through, untouched. */}
      <section className="rx-piIntro" aria-label="Upload. Wait. Review. Ship.">
        <div className="rx-piIntro-inner rx-piCta">
          {/* Four-word summary of the whole flow — one word per line, each its
              own ScrollReveal so the section keeps its signature word-by-word
              blur/opacity/tilt reveal. Widened horizontally (scaleX, echoing the
              REJOX wordmark) rather than by font-size alone. */}
          {['Upload.', 'Wait.', 'Review.', 'Ship.'].map((word) => (
            <ScrollReveal
              key={word}
              containerClassName="rx-piIntro-reveal rx-piCta-line"
              textClassName="rx-piCta-word"
              baseOpacity={0}
              baseRotation={4}
              blurStrength={10}
              enableBlur
            >
              {word}
            </ScrollReveal>
          ))}
          {/* Closing CTA — the SAME button as the hero's "Start migration"
              (identical markup, classes and icon-chip), centered below. */}
          <div className="rx-piCta-actions">
            <button type="button" className="rx-start">
              <span className="rx-start-label">Start migration</span>
              <span className="rx-start-chip" aria-hidden="true">
                <ArrowRight />
              </span>
            </button>
          </div>
        </div>
      </section>
    </>
  )
}

/* ============================================================================
 * Migration Pipeline — a full-width, tall section whose six migration stages
 * (Upload -> Understand -> Plan -> Ask -> Convert -> Validate) sit along a
 * smooth serpentine SVG path that snakes down the section, weaving between the
 * left and right edges.
 *
 * The path draws itself in as you scroll (GSAP ScrollTrigger, scrub — tied to
 * scroll position, not autoplay), a soft glow marking its leading edge. Node
 * lighting / particles / the final burst ride the same scrubbed progress.
 *
 * Path geometry — a single SVG <path> of chained cubic Béziers. Each node is
 * an anchor; between two anchors the two control points share the segment's
 * y-midpoint (with the endpoints' x), which makes the tangent vertical at
 * every anchor. Consecutive segments therefore meet with matching vertical
 * tangents => a G1-continuous curve with no sharp corners. The SVG uses
 * viewBox 1200x1400 and `preserveAspectRatio="none"` so the curve fills the
 * (full-width, tall) container on both axes; `vector-effect: non-scaling-
 * stroke` keeps the stroke crisp despite the non-uniform scale.
 *
 * Nodes — the six anchors are positioned with the SAME percentage coordinates
 * (x/y below, = anchor / viewBox * 100), so each node centre lands exactly on
 * its path point. They currently carry their data (number, title, desc) but
 * are `visibility: hidden` — laid out on the path yet painting nothing. The
 * reveal animation is wired up in a later step.
 * ==========================================================================*/

/* Six stages, in order. `x`/`y` are the node-centre coordinates as a % of the
   path container — they equal the SVG anchor points (anchor / viewBox * 100),
   so nodes and curve share one coordinate space. Anchors alternate left/right
   (x = 100 or 1100 of 1200) and step evenly down (y = 120,352,584,...,1280 of
   1400). */
const PL_STAGES = [
  { id: 'upload', title: 'Upload', desc: 'Project', x: 8.3333, y: 8.5714 },
  { id: 'understand', title: 'Understand', desc: 'Knowledge graph', x: 91.6667, y: 25.1429 },
  { id: 'plan', title: 'Plan', desc: 'Ordered plan', x: 8.3333, y: 41.7143 },
  { id: 'ask', title: 'Ask', desc: 'Human decisions', x: 91.6667, y: 58.2857 },
  { id: 'convert', title: 'Convert', desc: 'AST + AI transforms', x: 8.3333, y: 74.8571 },
  { id: 'validate', title: 'Validate', desc: 'tsc + Metro', x: 91.6667, y: 91.4286 },
] as const

/* One lucide-react icon per stage, keyed by stage id. Size/colour come from the
   `.rx-pl-node-marker svg` rule so the circle/ring/glow container is unchanged;
   only the glyph inside swaps to a proper icon-library component. */
const PIPELINE_ICONS: Record<string, LucideIcon> = {
  upload: Upload, // 01 Upload
  understand: Network, // 02 Understand — knowledge-graph / network
  plan: ListChecks, // 03 Plan — checklist
  ask: MessageCircleQuestion, // 04 Ask — question / message
  convert: RefreshCw, // 05 Convert — transform / refresh
  validate: ShieldCheck, // 06 Validate — shield-check
}

function PipelineIcon({ id }: { id: string }) {
  const Icon = PIPELINE_ICONS[id]
  return <Icon strokeWidth={1.7} aria-hidden="true" />
}

/* Path viewBox — kept in sync with the <svg> below. Node anchors are expressed
   as a % of this box (see PL_STAGES x/y), so mapping a viewBox point to
   container pixels is just point * (containerSize / viewBox). */
const PL_VBW = 1200
const PL_VBH = 1400
/* Vertical fractions of the FIRST (Upload) and LAST (Validate) nodes within the
   path container — the scrub runs between "node1 at viewport centre" and "node6
   at viewport centre", so the trail draws across the whole path over that scroll. */
const PL_START_FRAC = PL_STAGES[0].y / 100
const PL_END_FRAC = PL_STAGES[PL_STAGES.length - 1].y / 100
/* number of spark spans per node's one-shot activation burst; the final
   (Validate) node gets a slightly larger burst for the completion moment. */
const PL_SPARKS = 10
const PL_SPARKS_FINALE = 14
/* extra scroll — as a fraction of the path-container height — reserved AFTER
   the trail reaches Validate, over which the "Production Ready" finale text
   fades/slides in (a separate scrubbed trigger, so the trail/node math is
   untouched). */
const PL_FINALE_FRAC = 0.11

function MigrationPipeline() {
  const pathRef = useRef<SVGPathElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)
  const nodeRefs = useRef<(HTMLLIElement | null)[]>([])
  const finaleRef = useRef<HTMLDivElement | null>(null)
  const reduced = usePrefersReducedMotion()

  /* Scroll-linked trail reveal + node activation, both driven by the SAME
     scrubbed progress `u` so reveals stay locked to the trail's leading edge.

     Trail: the path draws itself in via stroke-dashoffset, tied directly to
     scroll (GSAP ScrollTrigger, scrub) — no autoplay. Because the SVG scales
     non-uniformly (preserveAspectRatio="none"), we sample the path with
     getPointAtLength in viewBox units, map each sample to CONTAINER PIXELS, and
     build an arc-length lookup so equal scroll => equal pixel travel (steady
     visual speed). A soft glow head is pinned to the stroke's leading edge (the
     same getPointAtLength point that defines where the reveal ends), so the tip
     of the line reads as a glowing head with nothing to drift out of sync.

     Nodes: the six anchors are congruent, evenly-stepped segments, so node j
     sits at pixel-arc-length u = j/5. As `u` sweeps a node's threshold we ramp
     a per-node CSS var `--p` (glow/scale/opacity) and `--pt` (its text) — pure
     style writes, no React re-render. Each node fully reveals on forward pass
     and stays lit (progressive completion); scrolling back cleanly un-reveals
     (the scrub reverses). A short one-shot particle burst fires once when the
     trail's head ARRIVES at a node (on threshold-cross, not per tick).

     Finale: at Validate (the last node) the burst is a touch larger and adds a
     single soft ring pulse; a separate scrubbed trigger then slides in the
     "Production Ready" text over reserved tail scroll, and reverses cleanly. */
  useEffect(() => {
    const pathEl = pathRef.current
    const containerEl = containerRef.current
    const tipEl = tipRef.current
    if (!pathEl || !containerEl || !tipEl) return

    const total = pathEl.getTotalLength()
    // start fully hidden: the trail draws itself in as its head advances
    // (stroke-dashoffset reveal, synced to the same progress `u`).
    pathEl.style.strokeDasharray = String(total)
    pathEl.style.strokeDashoffset = String(total)
    const SAMPLES = 600
    const LAST = PL_STAGES.length - 1
    const REVEAL_W = 0.07 // scroll-progress width of a node's reveal ramp
    let lut: { d: number; x: number; y: number; s: number }[] = []
    let totalPx = 0
    let sx = 1
    let sy = 1

    /* Rebuild the pixel-space arc-length table for the current container size. */
    const buildLUT = () => {
      sx = containerEl.clientWidth / PL_VBW
      sy = containerEl.clientHeight / PL_VBH
      lut = []
      let prevX = 0
      let prevY = 0
      let cum = 0
      for (let i = 0; i <= SAMPLES; i++) {
        const pt = pathEl.getPointAtLength((i / SAMPLES) * total)
        const x = pt.x * sx
        const y = pt.y * sy
        if (i > 0) cum += Math.hypot(x - prevX, y - prevY)
        lut.push({ d: cum, x, y, s: (i / SAMPLES) * total })
        prevX = x
        prevY = y
      }
      totalPx = cum || 1
    }

    /* Map progress u∈[0,1] (fraction of pixel arc-length) to the leading edge,
       and drive BOTH the trail reveal and the glowing head from it. */
    const place = (u: number) => {
      const target = Math.max(0, Math.min(1, u)) * totalPx
      let lo = 0
      let hi = lut.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (lut[mid].d < target) lo = mid + 1
        else hi = mid
      }
      const b = lut[lo]
      const a = lut[Math.max(0, lo - 1)]
      const seg = b.d - a.d || 1
      const t = (target - a.d) / seg
      // `vbLen` — the user-unit arc length of the leading edge — is the SINGLE
      // value that drives everything below. There is no separate arrow element
      // any more: the revealed stroke is the only moving visual, and its glowing
      // head is pinned to the exact point the stroke currently ends at, so a
      // desync between "tip" and "trail" is structurally impossible.
      const vbLen = a.s + (b.s - a.s) * t
      // trail: reveal the path up to the leading edge (stroke-dashoffset).
      pathEl.style.strokeDashoffset = String(total - vbLen)
      // glow head: the SAME getPointAtLength(vbLen) that defines where the drawn
      // stroke ends, mapped to container pixels — glow-centre ≡ stroke-end by
      // construction. Centred on the point (xPercent/yPercent -50 below).
      const tip = pathEl.getPointAtLength(vbLen)
      gsap.set(tipEl, {
        x: tip.x * sx,
        y: tip.y * sy,
        // stays hidden until motion begins; fades in over the first sliver.
        opacity: Math.min(1, Math.max(0, u / 0.02)),
      })
    }

    const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
    const lastP = new Array(PL_STAGES.length).fill(-1)
    const fired = new Array(PL_STAGES.length).fill(false)
    let prevU = 0

    /* One-shot spark burst — animates only transform/opacity on a handful of
       pre-existing spans, killing any prior tween so it can cleanly replay. The
       final (Validate) node gets a modestly larger burst plus ONE soft ring
       pulse — a restrained "completion" accent, not fireworks. */
    const fireBurst = (j: number) => {
      const el = nodeRefs.current[j]
      if (!el) return
      const finale = j === LAST
      const sparks = el.querySelectorAll<HTMLElement>('.rx-pl-spark')
      if (!sparks.length) return
      const n = sparks.length
      const radius = finale ? 30 : 22
      gsap.killTweensOf(sparks)
      gsap.fromTo(
        sparks,
        { x: 0, y: 0, scale: 1, opacity: 1 },
        {
          x: (i: number) => Math.cos((i / n) * Math.PI * 2 + j) * (radius + (i % 3) * 10),
          y: (i: number) => Math.sin((i / n) * Math.PI * 2 + j) * (radius + (i % 3) * 10),
          scale: 0.2,
          opacity: 0,
          duration: finale ? 0.72 : 0.6,
          ease: 'power2.out',
          overwrite: true,
        }
      )
      if (finale) {
        const ring = el.querySelector<HTMLElement>('.rx-pl-node-ring')
        if (ring) {
          gsap.killTweensOf(ring)
          gsap.fromTo(
            ring,
            { scale: 0.5, opacity: 0.5 },
            { scale: 1.5, opacity: 0, duration: 0.85, ease: 'power2.out', overwrite: true }
          )
        }
      }
    }

    /* Deterministic function of `u`: set each node's reveal vars, and fire the
       burst exactly once per forward threshold-cross. */
    const applyReveal = (u: number) => {
      for (let j = 0; j <= LAST; j++) {
        const el = nodeRefs.current[j]
        if (!el) continue
        // last node reveals over its final approach (no scroll exists past u=1)
        const start = j === LAST ? 1 - REVEAL_W : j / LAST
        const p = clamp01((u - start) / REVEAL_W)
        if (p !== lastP[j]) {
          el.style.setProperty('--p', p.toFixed(3))
          el.style.setProperty('--pt', clamp01((p - 0.35) / 0.65).toFixed(3))
          lastP[j] = p
        }
      }
      if (!reduced) {
        for (let j = 0; j <= LAST; j++) {
          const fireAt = j === 0 ? 0.02 : j / LAST // node arrival (u = j/5)
          if (!fired[j] && prevU < fireAt && u >= fireAt) {
            fired[j] = true
            fireBurst(j)
          } else if (fired[j] && u < fireAt - 0.03) {
            fired[j] = false // re-arm after scrolling back up past the node
          }
        }
      }
      prevU = u
    }

    /* Finale text ("Production Ready") — driven by --pf on a SEPARATE scrubbed
       trigger that begins exactly where the trail reaches Validate (node6 at
       centre) and runs across the reserved tail scroll, so the text slides in
       just after Validate's completion burst and un-reveals cleanly in reverse.
       The trail/node math above is left completely untouched. */
    const setFinale = (f: number) => {
      finaleRef.current?.style.setProperty('--pf', clamp01(f).toFixed(3))
    }

    // Centre the glow head on its placement point, once. The x/y set in place()
    // is the stroke's leading-edge coordinate, so offsetting the element by half
    // its own box (xPercent/yPercent -50) makes the glow's centre sit exactly on
    // the point where the drawn stroke ends.
    gsap.set(tipEl, { xPercent: -50, yPercent: -50 })

    buildLUT()
    place(0)
    applyReveal(0)
    setFinale(0)

    /* reduced-motion: no scrubbing/particles; hide the glow head and show
       every node — and the finale — in the settled, fully-revealed state. */
    if (reduced) {
      for (const el of nodeRefs.current) {
        if (!el) continue
        el.style.setProperty('--p', '1')
        el.style.setProperty('--pt', '1')
      }
      setFinale(1)
      // settled state: draw the whole path, no travelling glow head
      pathEl.style.strokeDashoffset = '0'
      gsap.set(tipEl, { opacity: 0 })
      return
    }

    const proxy = { u: 0 }
    const tween = gsap.to(proxy, {
      u: 1,
      ease: 'none',
      onUpdate: () => {
        place(proxy.u)
        applyReveal(proxy.u)
      },
      scrollTrigger: {
        trigger: containerEl,
        start: () => `top+=${containerEl.clientHeight * PL_START_FRAC} center`,
        end: () => `top+=${containerEl.clientHeight * PL_END_FRAC} center`,
        // small scrub number (not `true`) => a touch of easing lag that smooths
        // the trail travel without decoupling it from scroll position.
        scrub: 0.6,
        invalidateOnRefresh: true,
        onRefresh: () => {
          buildLUT()
          place(proxy.u)
          applyReveal(proxy.u)
        },
      },
    })

    const finaleProxy = { f: 0 }
    const finaleTween = gsap.to(finaleProxy, {
      f: 1,
      ease: 'none',
      onUpdate: () => setFinale(finaleProxy.f),
      scrollTrigger: {
        trigger: containerEl,
        start: () => `top+=${containerEl.clientHeight * PL_END_FRAC} center`,
        end: () =>
          `top+=${containerEl.clientHeight * (PL_END_FRAC + PL_FINALE_FRAC)} center`,
        scrub: 0.6,
        invalidateOnRefresh: true,
        onRefresh: () => setFinale(finaleProxy.f),
      },
    })

    return () => {
      tween.scrollTrigger?.kill()
      tween.kill()
      finaleTween.scrollTrigger?.kill()
      finaleTween.kill()
    }
  }, [reduced])

  return (
    <section className="rx-plsec" aria-label="Migration Pipeline">
      <div className="rx-pl-head">
        <div className="rx-eyebrow">
          <span className="rx-rule" />
          <span className="rx-label">Migration Pipeline</span>
        </div>
        <h2 className="rx-pl-title">
          From React to React Native, in six stages.
        </h2>
      </div>

      {/* Full-width, tall path region. The serpentine SVG fills it on both
          axes; the six nodes are absolutely positioned on the same %
          coordinates as the SVG anchors, so they sit exactly on the curve. */}
      <div className="rx-pl-path" ref={containerRef}>
        <svg
          className="rx-pl-svg"
          viewBox="0 0 1200 1400"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="rxPlStroke" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="48%" stopColor="#eef2ff" />
              <stop offset="52%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#e9edf7" />
            </linearGradient>
          </defs>
          <path
            ref={pathRef}
            className="rx-pl-curve"
            d="M 100 120 C 100 236 1100 236 1100 352 C 1100 468 100 468 100 584 C 100 700 1100 700 1100 816 C 1100 932 100 932 100 1048 C 100 1164 1100 1164 1100 1280"
            fill="none"
            stroke="url(#rxPlStroke)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>

        {/* Glowing head of the trail — a soft radial glow pinned in JS to the
            exact point where the revealed stroke currently ends. Not a separate
            shape: it just brightens the tip of the one moving line, so it can
            never drift ahead of / behind the trail. */}
        <div className="rx-pl-tip" ref={tipRef} aria-hidden="true" />

        <ol className="rx-pl-nodes">
          {PL_STAGES.map((stage, i) => {
            const isLast = i === PL_STAGES.length - 1
            return (
              <li
                key={stage.id}
                ref={(el) => {
                  nodeRefs.current[i] = el
                }}
                className="rx-pl-node"
                style={{ left: `${stage.x}%`, top: `${stage.y}%` }}
              >
                {/* soft one-shot ring pulse — only on the final (Validate) node */}
                {isLast && <span className="rx-pl-node-ring" aria-hidden="true" />}
                {/* marker centred exactly on the path point; glows/scales via --p */}
                <div className="rx-pl-node-marker">
                  <PipelineIcon id={stage.id} />
                </div>
                {/* one-shot spark burst — sibling of the marker so its opacity is
                    never gated by the marker's reveal; animated by GSAP on arrival */}
                <span className="rx-pl-node-burst" aria-hidden="true">
                  {Array.from({ length: isLast ? PL_SPARKS_FINALE : PL_SPARKS }).map(
                    (_, k) => (
                      <span key={k} className="rx-pl-spark" />
                    )
                  )}
                </span>
                {/* text below the marker; fades + slides in via --pt */}
                <div className="rx-pl-node-text">
                  <span className="rx-pl-node-num" aria-hidden="true">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="rx-pl-node-title">{stage.title}</span>
                  <span className="rx-pl-node-desc">{stage.desc}</span>
                </div>
              </li>
            )
          })}
        </ol>

        {/* Finale — the completion moment, above/near the Validate endpoint.
            Fades + slides in via --pf (driven by the separate finale trigger). */}
        <div className="rx-pl-finale" ref={finaleRef}>
          <span className="rx-pl-finale-title">
            <span className="rx-pl-finale-check" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 12.5 10 17.5 19.5 6.5"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            Production Ready
          </span>
          <span className="rx-pl-finale-sub">React Native Project Generated</span>
        </div>
      </div>
    </section>
  )
}

/* ============================================================================
 * Analysis Dashboard — visualises Rejox's post-analysis output. Data-dense and
 * scannable rather than "live": a one-shot reveal-on-scroll, no looping.
 *
 * Composition — a top row of three cards: Coverage and Confidence as two
 * SEPARATE ring gauges (held visually apart — different metrics, never merged
 * into one score), plus a prominent "LLM calls: 1" panel that gives Rejox's
 * key differentiator (mostly deterministic, AI used surgically) real visual
 * weight. Below, a full-width, explainable "signed score contribution"
 * breakdown: each factor is + or -, colour- AND glyph- AND direction-coded so
 * the sign never depends on colour alone (the palette is warm-only).
 *
 * Reveal — an IntersectionObserver flips `revealed` once; the ring arcs (kept
 * mounted from load at an empty offset) then transition their stroke-dashoffset
 * to the target, and the contribution bars grow. `prefers-reduced-motion`
 * shows the fully-settled state instantly (`no-anim` => transition:none).
 *
 * NOTE: every number/label below is an illustrative PLACEHOLDER.
 * ==========================================================================*/

// TODO: wire to real sample-app analysis data (all values in this block)
const AD_COVERAGE = 94 // % of the codebase analyzed & mapped
const AD_CONFIDENCE = 87 // % confidence in the proposed migration plan
const AD_LLM_CALLS = 1 // AI invocations — deliberately tiny
const AD_CONTRIBUTIONS: { sign: '+' | '-'; label: string; weight: number }[] = [
  { sign: '+', label: 'Clean, typed component structure', weight: 9 },
  { sign: '+', label: 'Standard routing (React Router → Navigation)', weight: 7 },
  { sign: '+', label: 'Centralized state (Zustand) maps cleanly', weight: 6 },
  { sign: '+', label: 'Typed API layer (Axios) is portable', weight: 4 },
  { sign: '-', label: 'Framer Motion needs a Reanimated rewrite', weight: 6 },
  { sign: '-', label: 'Direct DOM / web-only APIs detected', weight: 5 },
  { sign: '-', label: '2 libraries without RN equivalents', weight: 4 },
]

const AD_RING_R = 52
const AD_RING_C = 2 * Math.PI * AD_RING_R // 326.726
const adRingOffset = (pct: number) => AD_RING_C * (1 - pct / 100)
const AD_MAX_WEIGHT = Math.max(...AD_CONTRIBUTIONS.map((c) => c.weight))
/* Net is intentionally subordinate (a small footer, not a third headline
   metric competing with Coverage/Confidence). */
const AD_NET = AD_CONTRIBUTIONS.reduce(
  (n, c) => n + (c.sign === '+' ? c.weight : -c.weight),
  0
)

function MetricRing({
  pct,
  revealed,
  reduced,
  variant,
}: {
  pct: number
  revealed: boolean
  reduced: boolean
  variant: string
}) {
  // Mounted at the empty offset from load; flipping to the target while mounted
  // is what makes the stroke-dashoffset TRANSITION (not snap) on reveal.
  const offset = revealed ? adRingOffset(pct) : AD_RING_C
  return (
    <div className={'rx-ad-ring ' + variant + (reduced ? ' no-anim' : '')}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="rx-ad-ring-track" cx="60" cy="60" r="52" />
        <circle
          className="rx-ad-ring-arc"
          cx="60"
          cy="60"
          r="52"
          style={{ strokeDashoffset: offset }}
        />
      </svg>
      <div className="rx-ad-ring-num">
        {pct}
        <span className="rx-ad-ring-pct">%</span>
      </div>
    </div>
  )
}

function AnalysisDashboard() {
  const sectionRef = useRef<HTMLElement | null>(null)
  const reduced = usePrefersReducedMotion()
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    if (reduced) {
      setRevealed(true)
      return
    }
    const el = sectionRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true)
          io.disconnect()
        }
      },
      { threshold: 0.25 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [reduced])

  return (
    <section
      ref={sectionRef}
      className={'rx-adsec' + (revealed ? ' is-revealed' : '')}
      aria-label="Analysis Dashboard"
    >
      <div className="rx-ad-inner">
        <div className="rx-ad-head">
          <div className="rx-eyebrow">
            <span className="rx-rule" />
            <span className="rx-label">Analysis Dashboard</span>
          </div>
          <h2 className="rx-ad-title">
            Transparent scoring — every number is explainable.
          </h2>
        </div>

        {/* Top row: two distinct metric rings + the prominent LLM-calls stat. */}
        <div className="rx-ad-top">
          <div className="rx-ad-card rx-ad-metric">
            <MetricRing
              pct={AD_COVERAGE}
              revealed={revealed}
              reduced={reduced}
              variant="rx-ad-ring-coverage"
            />
            <div className="rx-ad-metric-copy">
              <span className="rx-ad-metric-name">Coverage</span>
              <span className="rx-ad-metric-sub">
                of the codebase analyzed &amp; mapped
              </span>
            </div>
          </div>

          <div className="rx-ad-card rx-ad-metric">
            <MetricRing
              pct={AD_CONFIDENCE}
              revealed={revealed}
              reduced={reduced}
              variant="rx-ad-ring-confidence"
            />
            <div className="rx-ad-metric-copy">
              <span className="rx-ad-metric-name">Confidence</span>
              <span className="rx-ad-metric-sub">
                in the proposed migration plan
              </span>
            </div>
          </div>

          <div className="rx-ad-card rx-ad-llm">
            <span className="rx-ad-llm-label">LLM calls</span>
            <span className="rx-ad-llm-num">{AD_LLM_CALLS}</span>
            <span className="rx-ad-llm-sub">
              Everything else resolved deterministically — AI is a scalpel, not
              the default path.
            </span>
          </div>
        </div>

        {/* Signed, weighted score-contribution breakdown — explainable. */}
        <div className="rx-ad-card rx-ad-break">
          <div className="rx-ad-break-head">
            <span className="rx-ad-break-title">Score contribution</span>
            <span className="rx-ad-break-sub">
              Every factor, signed and weighted — not a black box.
            </span>
          </div>
          <ul className="rx-ad-rows">
            {AD_CONTRIBUTIONS.map((c, i) => {
              const positive = c.sign === '+'
              const width = (c.weight / AD_MAX_WEIGHT) * 100
              return (
                <li
                  key={c.label}
                  className={'rx-ad-row ' + (positive ? 'is-pos' : 'is-neg')}
                >
                  <span className="rx-ad-sign" aria-hidden="true">
                    {c.sign}
                  </span>
                  <span className="rx-ad-row-label">{c.label}</span>
                  <span className="rx-ad-bar" aria-hidden="true">
                    <span
                      className="rx-ad-bar-fill"
                      style={{
                        width: revealed ? width + '%' : '0%',
                        transitionDelay: revealed && !reduced ? i * 70 + 'ms' : '0ms',
                      }}
                    />
                  </span>
                  <span className="rx-ad-weight">
                    {c.sign}
                    {c.weight}
                  </span>
                </li>
              )
            })}
          </ul>
          <div className="rx-ad-break-foot">
            <span className="rx-ad-net-label">Net contribution</span>
            <span className="rx-ad-net-val">
              {AD_NET > 0 ? '+' : ''}
              {AD_NET}
            </span>
            <span className="rx-ad-net-note">toward the confidence score</span>
          </div>
        </div>
      </div>
    </section>
  )
}

export function Home() {
  return (
    <div className="rx-home">
      {/* WebGL light-pillar background — a single fixed, full-viewport layer
          behind everything (z-index 0, below the frame at z1 and the fixed
          header at z50). pointer-events:none so it never intercepts clicks.
          scrollSettle makes the shader calm and resolve to flat black as the
          page scrolls from the hero into Section 02, so there's no hard seam.
          Falls back to a "WebGL not supported" note if unavailable. */}
      <div className="rx-pillar-fixed" aria-hidden="true">
        <LightPillar
          topColor="#FF6A00"
          bottomColor="#FF9FFC"
          intensity={1}
          rotationSpeed={0.3}
          glowAmount={0.002}
          pillarWidth={3}
          pillarHeight={0.4}
          noiseIntensity={0.5}
          pillarRotation={25}
          interactive={false}
          mixBlendMode="screen"
          quality="high"
          scrollSettle
        />
      </div>

      {/* ---------- floating capsule header: fixed to the viewport, sibling
          of both the hero and Section 02 so it stays visible for the whole
          page. ---------- */}
      <motion.header
        className="rx-header"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <img className="rx-logo" src={rejoxLogo} alt="Rejox" />

        <nav className="rx-nav" aria-label="Primary">
          {NAV_ITEMS.map((item, i) => (
            <button
              key={item}
              type="button"
              className={
                'rx-nav-item ' + (i === 0 ? 'is-active' : 'is-inactive')
              }
              aria-current={i === 0 ? 'page' : undefined}
            >
              {item}
            </button>
          ))}
        </nav>

        <button type="button" className="rx-cta-pill">
          Login
        </button>
      </motion.header>

      <div className="rx-hero">
        <div className="rx-frame">
          {/* ---------- mid: left content block; center/right left empty ---------- */}
          <div className="rx-mid">
            <motion.div
              className="rx-left"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
            >
              <div className="rx-eyebrow">
                <span className="rx-rule" />
                <span className="rx-label">AI Migration Engineer</span>
              </div>
              <p className="rx-sentence">
                Upload your React project. Rejox analyzes, plans, and migrates it
                into React Native with deterministic transforms and targeted AI
                assistance.
              </p>
              <button type="button" className="rx-start">
                <span className="rx-start-label">Start migration</span>
                <span className="rx-start-chip" aria-hidden="true">
                  <ArrowRight />
                </span>
              </button>
              {/* three succinct proof points under the button — muted, divider-
                  separated, sized well below the heading so they never compete. */}
              <ul className="rx-hero-feats" aria-label="What Rejox is">
                <li>Deterministic</li>
                <li>AI-assisted</li>
                <li>Production-ready</li>
              </ul>
            </motion.div>
          </div>

          {/* ---------- right side: stacked frosted BorderGlow cards ----------
              Absolutely positioned in the hero's upper-right (below the header,
              above the REJOX wordmark) to balance the left content block. Glassy
              /translucent so the LightPillar shows through; glow tuned to the
              hero's orange→pink palette. */}
          <motion.div
            className="rx-cards"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.28 }}
          >
            {/* Large card — glow from the hero's orange (HSL triplet, the format
                the port's parseHSL expects), mesh from the LightPillar's
                topColor→bottomColor (orange→pink). Glassy via backdropBlur. */}
            <BorderGlow
              className="rx-card rx-card-lg"
              glowColor="25 100 50"
              colors={['#ff6a00', '#ff9ffc']}
              backgroundColor="rgba(20, 12, 16, 0.34)"
              borderRadius={22}
              glowRadius={50}
              glowIntensity={1}
              coneSpread={22}
              edgeSensitivity={22}
              fillOpacity={0.6}
              backdropBlur={16}
            >
              <div className="rx-card-body rx-card-body-lg">
                <span className="rx-card-chip" aria-hidden="true">
                  <ChipIcon />
                </span>
                <span className="rx-card-eyebrow">Deterministic + AI-assisted</span>
                <span className="rx-card-title">Intelligent migration</span>
                <span className="rx-card-sub">
                  AST-precise transforms first — AI only for the residue.
                </span>
              </div>
            </BorderGlow>

            {/* Small card — glow from the hero's pink (HSL triplet), mesh
                including --rx-red. */}
            <BorderGlow
              className="rx-card rx-card-sm"
              glowColor="302 100 81"
              colors={['#c53322', '#ff9ffc']}
              backgroundColor="rgba(20, 12, 16, 0.34)"
              borderRadius={18}
              glowRadius={40}
              glowIntensity={1}
              coneSpread={22}
              edgeSensitivity={22}
              fillOpacity={0.6}
              backdropBlur={16}
            >
              <div className="rx-card-body rx-card-body-sm">
                <span className="rx-card-chip rx-card-chip-sm" aria-hidden="true">
                  <BoltIcon />
                </span>
                <span className="rx-card-title rx-card-title-sm">
                  Production-ready React Native
                </span>
              </div>
            </BorderGlow>
          </motion.div>

          {/* ---------- bottom wordmark: static outlined stroke ---------- */}
          <motion.div
            className="rx-wordmark-wrap"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
          >
            <div className="rx-wordmark rx-wordmark-stroke">REJOX</div>
          </motion.div>
        </div>
      </div>

      {/* Section 02 — the Migration Pipeline horizontal timeline. */}
      <MigrationPipeline />

      {/* Section 03 — the Analysis Dashboard (Coverage/Confidence/LLM + scoring). */}
      <AnalysisDashboard />

      {/* Section 04 (LAST) — Project Intelligence, now the page's closing
          call-to-action: a four-word summary of the flow + START MIGRATION. */}
      <ProjectIntelligence />
    </div>
  )
}
