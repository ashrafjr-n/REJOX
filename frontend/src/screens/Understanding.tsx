import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

import './Understanding.css'
import showcase from '../data/showcase.json'
import type { ShowcaseData } from '../types/showcase.generated'

/**
 * Scene 01 — "Understanding".
 *
 * The first scroll-driven section below the hero: it states, with real numbers
 * from an actual pipeline run, what Rejox learns about a project *before it
 * touches it*. This session builds the SHELL and proves the scroll mechanics —
 * the visual scene that fills the three placeholder slots comes next session.
 *
 * Scroll mechanics (GSAP ScrollTrigger, the house pattern):
 * - The section is PINNED while the user scrolls through it, over a distance
 *   long enough for three distinct "beats".
 * - Scroll progress drives a beat index (0 → 1 → 2); the active placeholder is
 *   highlighted and the others dimmed — the visible proof the mechanism works.
 * - The trigger is created with a ref we hold and, on cleanup, we kill ONLY that
 *   instance (never a global ScrollTrigger.getAll().kill()), so this section and
 *   ScrollReveal coexist without tearing down each other's triggers. The plugin
 *   is registered in THIS module — we don't rely on any other component's
 *   registration.
 * - StrictMode-safe: mount → cleanup → remount re-creates the trigger cleanly
 *   because kill() reverts the pin-spacer it inserted.
 *
 * Reduced motion: when `prefers-reduced-motion: reduce` is set we do NOT pin or
 * scrub. The section renders as a normal-height block with all three slots
 * visible and equally prominent and the readout shown in full — nothing needs
 * scrolling to be seen.
 *
 * Desktop only this session; responsive/mobile behaviour is deliberately out of
 * scope.
 */

gsap.registerPlugin(ScrollTrigger)

const BEAT_COUNT = 3
// Pin distance = one viewport per beat. Long enough that each of the three
// beats gets a full screen of scroll to read as a distinct, deliberate step
// (not a flicker), and it scales with the viewport rather than a magic pixel
// count. Resolved lazily in `end` so it tracks the live innerHeight.
const BEATS_IN_VIEWPORTS = BEAT_COUNT

const data = showcase as ShowcaseData

// --- The readout figures. Four trace directly to showcase.json; the fifth is
//     the understanding-phase invariant (see UNDERSTANDING_LLM_CALLS). No figure
//     is written as a literal in JSX. ---
const sourceFileCount = (data.project.sourceFiles ?? []).length
const componentCount = data.project.counts.components
const routeCount = data.project.counts.routes
const edgeKindCount = new Set((data.graph.edges ?? []).map((e) => e.kind)).size

// Not a per-run measurement but an ARCHITECTURAL INVARIANT: the Project
// Intelligence Engine builds the knowledge graph deterministically — it reads
// the project with zero LLM calls. showcase.json only records the whole-run
// count (`results.llmCalls`, which is the later navigator-shape call made during
// *Migrate*, i.e. "touching it"); it has no per-phase field, so the reading
// phase's zero is stated here as the constant it is.
const UNDERSTANDING_LLM_CALLS = 0

interface Readout {
  label: string
  value: number
}

const READOUTS: Readout[] = [
  { label: 'Source files', value: sourceFileCount },
  { label: 'Components', value: componentCount },
  { label: 'Routes', value: routeCount },
  { label: 'Edge kinds', value: edgeKindCount },
  { label: 'LLM calls', value: UNDERSTANDING_LLM_CALLS },
]

const SLOTS = ['Raw files', 'Knowledge graph', 'Build order']

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export default function Understanding() {
  const sectionRef = useRef<HTMLElement | null>(null)
  // Read once at mount; the section's whole behaviour branches on it.
  const [reduced] = useState(prefersReducedMotion)
  const [pinned, setPinned] = useState(false)
  const [beat, setBeat] = useState(0)

  useEffect(() => {
    // Reduced motion: no pin, no scrub. The section is a normal block with every
    // slot equally prominent (handled in render via `reduced`).
    if (reduced) return

    const el = sectionRef.current
    if (!el) return

    // The single ScrollTrigger THIS component owns. Cleanup kills only this
    // instance (which reverts its pin-spacer), so ScrollReveal's triggers — and
    // any other component's — are never touched. StrictMode's mount → cleanup →
    // remount therefore re-creates it from a clean slate.
    const st = ScrollTrigger.create({
      trigger: el,
      start: 'top top',
      end: () => '+=' + window.innerHeight * BEATS_IN_VIEWPORTS,
      pin: true,
      pinSpacing: true,
      // A modest scrub so the pin feels anchored to the scrollbar rather than
      // easing on its own; the beat index itself is a discrete function of
      // progress, computed in onUpdate/onToggle below.
      scrub: true,
      onToggle: (self) => setPinned(self.isActive),
      onUpdate: (self) => {
        // progress 0→1 across the pinned range → beat 0,1,2. clamp so the exact
        // end (progress === 1) stays on the last beat rather than overflowing.
        const next = Math.min(BEAT_COUNT - 1, Math.floor(self.progress * BEAT_COUNT))
        setBeat(next)
      },
    })

    return () => {
      st.kill()
    }
  }, [reduced])

  return (
    <section
      ref={sectionRef}
      className={'rx-understanding' + (reduced ? ' is-reduced' : '')}
      aria-label="Scene 01 — Understanding"
      data-rx-understanding=""
      data-pinned={pinned ? 'true' : 'false'}
      data-beat={String(beat)}
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

        {/* Three placeholder slots — deliberate stand-ins for next session's
            scene. The active one (driven by the beat index) is highlighted, the
            others dimmed; under reduced motion all three are equally prominent. */}
        <div className="rx-u-slots">
          {SLOTS.map((caption, i) => (
            <div
              key={caption}
              className={
                'rx-u-slot' + (!reduced && i === beat ? ' is-active' : '')
              }
              data-rx-slot={String(i)}
            >
              <span className="rx-u-slot-caption">{caption}</span>
            </div>
          ))}
        </div>

        {/* Readout strip — mono, tabular numerals. Every figure is data-driven
            (four from showcase.json, one architectural invariant). */}
        <dl className="rx-u-readout">
          {READOUTS.map((r) => (
            <div key={r.label} className="rx-u-metric">
              <dt className="rx-u-metric-value tnum">{r.value}</dt>
              <dd className="rx-u-metric-label">{r.label}</dd>
            </div>
          ))}
        </dl>

        <p className="rx-u-attribution">
          Real figures from an actual Rejox pipeline run on the benchmark project
          (<span className="tnum">{data.project.name}</span>).
        </p>
      </div>
    </section>
  )
}
