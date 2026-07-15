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
 *   Phase 1 (progress 0 → 0.55): the flood. Black bg floods to #B0480C, REJOX
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
      tl.fromTo('.rx-flood', { scale: 0.001 }, { scale: 1.35, duration: d }, 0)
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
        <div className="rx-flood" />

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
