import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

import './Home.css'
import rejoxLogo from '../assets/rejox-logo.png'

gsap.registerPlugin(ScrollTrigger)

/**
 * Rejox marketing home — hero + a pinned OVERLAP reveal into Section 02.
 *
 * One scrubbed timeline drives the whole sequence while the hero stays pinned
 * (fixed) the entire time:
 *   Phase 1 (progress 0 → 0.55): the flood — six irregular ink-blot shapes
 *     (BLOBS below), scattered at different origins across the hero, each
 *     growing from scale~0 on its own staggered slice of the same 0→d
 *     timeline (no independent timers, fully scrubbable/reversible). Their
 *     union reads as solid #B0480C by ~0.55 with no visible seams, because
 *     every blob is the same flat opaque fill — see Home.css for why that
 *     (not a gradient) is what actually guarantees seamlessness. REJOX
 *     crossfades outlined → solid white (while also shrinking from a taller
 *     rest height down to today's height, width locked throughout), the left
 *     text turns white, and the Login pill inverts. Header nav items
 *     (Home/About/Docs/Features) and the hero "Start migration" button/chip
 *     are intentionally locked — their color never moves with scroll.
 *     Fully completes by ~0.55.
 *   Phase 2 (progress 0.55 → 1): Section 02 (white) slides up from the bottom
 *     (translateY 100% → 0), overlapping and fully covering the fixed hero.
 *     The hero never moves — only Section 02 travels.
 *
 * Technique: GSAP ScrollTrigger pins a one-viewport stage that holds the hero
 * (layer z1) and Section 02 (layer z2). Both are transform/opacity only, so
 * nothing animates layout. Chose a GSAP pin over CSS sticky because the two
 * phases need precise, independent control of *when* the flood finishes and
 * *when* the slide starts — a single scrubbed timeline expresses that exactly,
 * whereas pure sticky couples the slide to raw scroll position.
 *
 * The header is a THIRD sibling of the hero and Section 02 (not nested inside
 * either), styled `position: fixed` with z-index above both (z50 vs hero z1 /
 * Section 02 z2) — this is deliberate: nesting it inside `.rx-hero` would trap
 * it under that element's own stacking context (position:absolute + z-index),
 * so no z-index on the header could ever lift it above Section 02 once that
 * panel slides over. Being a plain sibling avoids that trap, and it stays
 * visible past the pinned sequence entirely, for the whole page. GSAP's
 * `.rx-cta-pill` selector-tween still finds it because gsap.context's scope is
 * `home` (the shared ancestor), not `hero`. `.rx-mid` carries a compensating
 * margin-top (39.5px) so removing the header from `.rx-frame`'s flex flow
 * doesn't shift the left content block that used to sit below it.
 *
 * prefers-reduced-motion: no pin/scrub/slide. The static rest hero renders,
 * with Section 02 stacked normally below it (the default document flow); the
 * header stays fixed regardless, since that's independent of the animation.
 * Everything is scoped under `.rx-home`; the /app workflow is untouched.
 */

const NAV_ITEMS = ['Home', 'About', 'Docs', 'Features']

const BLACK = '#050505'
const WHITE = '#ffffff'

/** Progress at which Phase 1 (flood) completes and Phase 2 (slide) begins. */
const PHASE_1 = 0.55

/** Extra px Section 02 travels past yPercent 0, so its rounded top corners
 * (and the matching extra height added in Home.css) scroll fully out of view. */
const SECTION2_OVERSHOOT_PX = 56

/** Four hand-authored organic blob outlines (closed Catmull-Rom splines
 * through a perturbed circle, viewBox 0 0 200 200) — irregular, non-circular
 * edges without any SVG filter. Reused across the 6 placed instances below. */
const BLOB_PATHS = [
  'M170.73,100.00 C165.63,113.03 157.65,118.94 152.39,130.25 C147.14,141.56 147.92,159.40 139.18,167.87 C130.45,176.34 113.92,179.61 100.00,181.09 C86.08,182.57 66.59,183.97 55.69,176.74 C44.80,169.51 40.85,150.52 34.65,137.73 C28.45,124.94 18.65,112.66 18.50,100.00 C18.36,87.34 25.41,70.78 33.80,61.78 C42.19,52.78 57.79,52.75 68.83,46.01 C79.86,39.26 87.60,24.80 100.00,21.32 C112.40,17.84 129.39,20.00 143.22,25.13 C157.06,30.26 178.41,39.61 182.99,52.09 C187.57,64.56 175.83,86.97 170.73,100.00 Z',
  'M179.07,100.00 C179.12,114.00 179.03,129.85 172.92,142.10 C166.81,154.35 154.59,167.84 142.43,173.50 C130.28,179.16 112.80,178.39 100.00,176.06 C87.20,173.73 74.70,166.95 65.65,159.50 C56.59,152.05 54.87,141.28 45.68,131.36 C36.49,121.44 14.99,113.04 10.51,100.00 C6.02,86.96 10.57,64.73 18.77,53.10 C26.97,41.47 46.18,33.64 59.72,30.23 C73.25,26.81 87.84,30.42 100.00,32.62 C112.16,34.83 120.55,39.21 132.65,43.45 C144.75,47.70 164.87,48.65 172.61,58.08 C180.35,67.50 179.02,86.00 179.07,100.00 Z',
  'M189.17,100.00 C186.72,113.48 170.89,124.65 162.70,136.20 C154.51,147.75 150.47,163.77 140.02,169.31 C129.57,174.86 112.50,170.94 100.00,169.48 C87.50,168.03 76.46,165.56 65.02,160.59 C53.58,155.61 40.55,149.72 31.37,139.63 C22.18,129.53 12.07,114.46 9.90,100.00 C7.74,85.54 8.64,62.02 18.38,52.88 C28.12,43.74 54.73,47.84 68.33,45.15 C81.94,42.46 88.44,38.49 100.00,36.75 C111.56,35.01 124.80,31.61 137.70,34.70 C150.60,37.80 168.82,44.43 177.40,55.31 C185.98,66.19 191.63,86.52 189.17,100.00 Z',
  'M180.37,100.00 C178.40,114.11 174.84,128.56 167.43,138.93 C160.02,149.30 147.17,155.52 135.93,162.23 C124.69,168.94 112.14,178.89 100.00,179.18 C87.86,179.46 73.69,171.02 63.08,163.95 C52.48,156.87 45.28,147.40 36.37,136.74 C27.46,126.08 11.13,113.12 9.62,100.00 C8.12,86.88 18.54,68.89 27.33,58.05 C36.13,47.20 50.31,38.26 62.42,34.91 C74.53,31.56 87.37,38.11 100.00,37.93 C112.63,37.75 124.99,31.12 138.20,33.84 C151.40,36.56 172.22,43.22 179.25,54.25 C186.27,65.27 182.34,85.89 180.37,100.00 Z',
]

/** Placement (className, matches Home.css) + which outline + staggered
 * [startFrac, endFrac] window (fractions of `d`, the flood's own 0→PHASE_1
 * span) each blob grows across. Staggered/uneven on purpose — not lockstep —
 * but all finish comfortably before d so the field reads solid by ~0.55. */
const BLOBS = [
  { cls: 'rx-blob-1', path: 0, start: 0.0, end: 0.6 },
  { cls: 'rx-blob-2', path: 1, start: 0.06, end: 0.66 },
  { cls: 'rx-blob-3', path: 2, start: 0.1, end: 0.72 },
  { cls: 'rx-blob-4', path: 3, start: 0.03, end: 0.62 },
  { cls: 'rx-blob-5', path: 1, start: 0.14, end: 0.78 },
  { cls: 'rx-blob-6', path: 3, start: 0.08, end: 0.7 },
] as const

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

export function Home() {
  const homeRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)
  const section2Ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const home = homeRef.current
    const hero = heroRef.current
    const section2 = section2Ref.current
    if (!home || !hero || !section2) return

    // Respect reduced-motion: no pin/scrub/slide. Leave the default flow —
    // static rest hero with Section 02 stacked below it.
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return

    const ctx = gsap.context(() => {
      // Motion layout: the stage is exactly one viewport; the hero and
      // Section 02 become stacked full-bleed layers within it. Section 02
      // starts fully below the fold (yPercent 100) and above the hero (z2).
      gsap.set(home, { position: 'relative', height: '100vh' })
      gsap.set(hero, {
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 1,
      })
      gsap.set(section2, {
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 2,
        yPercent: 100,
      })

      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: home,
          start: 'top top',
          end: '+=160%', // scrub distance for the two phases
          pin: true,
          scrub: true,
        },
      })

      // ---- Phase 1 (0 → PHASE_1): the flood, exactly as before but compressed
      // so every corner is solid #B0480C by ~0.55 and holds through Phase 2. ----
      const d = PHASE_1
      // Six staggered blobs, each scrubbed off its own slice of the same
      // 0→d span — see BLOBS above for placement/timing, Home.css for why
      // a flat opaque fill (not a gradient) is what guarantees no seams.
      for (const b of BLOBS) {
        tl.fromTo(
          `.${b.cls}`,
          { scale: 0.001, opacity: 0 },
          { scale: 1, opacity: 1, duration: (b.end - b.start) * d, ease: 'power1.out' },
          b.start * d,
        )
      }
      tl.to('.rx-glow', { opacity: 0, duration: d * 0.5 }, 0)
      tl.to('.rx-wordmark-fill', { opacity: 1, duration: d }, 0)
      // Height-only: scaleY never touches the X axis, so width is locked at
      // every scroll position. Runs on the same 0→d timeline as the fill
      // crossfade above, alongside it rather than replacing it.
      tl.to('.rx-wordmark', { scaleY: 1, duration: d }, 0)
      tl.to('.rx-label', { color: WHITE, duration: d }, 0)
      tl.to('.rx-rule', { backgroundColor: WHITE, duration: d }, 0)
      tl.to('.rx-sentence', { color: WHITE, duration: d }, 0)
      // The hero "Start migration" button and its chip are intentionally NOT
      // tweened — like the nav items, their color is locked to one fixed
      // scheme (light-silver pill, black chip) at every scroll position.
      // Nav items (Home/About/Docs/Features) are also NOT tweened — their
      // color is locked and must not move with scroll progress.
      tl.to(
        '.rx-cta-pill',
        { backgroundColor: BLACK, color: WHITE, boxShadow: '0 6px 18px rgba(0,0,0,0.3)', duration: d },
        0,
      )

      // ---- Phase 2 (PHASE_1 → 1): Section 02 slides up over the fixed hero.
      // yPercent:0 lands its top edge at the viewport top; the extra `y`
      // overshoot (matched by the extra height in Home.css) pushes it further
      // so the rounded top corners clear the top of the screen while the
      // bottom edge still lands exactly flush with the viewport bottom. ----
      tl.to(
        section2,
        { yPercent: 0, y: -SECTION2_OVERSHOOT_PX, duration: 1 - PHASE_1 },
        PHASE_1,
      )
    }, home)

    return () => ctx.revert()
  }, [])

  return (
    <div className="rx-home" ref={homeRef}>
      {/* ---------- floating capsule header: fixed to the viewport, sibling
          of both the hero and Section 02 (not nested in either) so it stays
          visible above both for the whole page, not just the pinned hero
          sequence — see the file doc comment for why it can't live inside
          `.rx-hero` and still escape via z-index. ---------- */}
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

      <div className="rx-hero" ref={heroRef}>
        <div className="rx-glow" />
        <div className="rx-blobs" aria-hidden="true">
          {BLOBS.map((b) => (
            <div key={b.cls} className={'rx-blob ' + b.cls}>
              <svg viewBox="0 0 200 200">
                <path d={BLOB_PATHS[b.path]} fill="#b0480c" />
              </svg>
            </div>
          ))}
        </div>

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
                Upload your React application and receive production-ready React
                Native architecture, powered by AI.
              </p>
              <button type="button" className="rx-start">
                <span className="rx-start-label">Start migration</span>
                <span className="rx-start-chip" aria-hidden="true">
                  <ArrowRight />
                </span>
              </button>
            </motion.div>
          </div>

          {/* ---------- bottom wordmark: stacked stroke + fill layers ---------- */}
          <motion.div
            className="rx-wordmark-wrap"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
          >
            <div className="rx-wordmark rx-wordmark-stroke">REJOX</div>
            <div className="rx-wordmark rx-wordmark-fill" aria-hidden="true">
              REJOX
            </div>
          </motion.div>
        </div>
      </div>

      {/* Section 02 — empty white panel that slides up to cover the pinned hero.
          Filled in the next prompt. In reduced-motion it simply stacks below. */}
      <section className="rx-section2" ref={section2Ref} aria-label="Section 02" />
    </div>
  )
}
