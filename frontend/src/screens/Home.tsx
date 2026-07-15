import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import gsap from 'gsap'

import './Home.css'
import rejoxLogo from '../assets/rejox-logo.png'

/**
 * Rejox marketing home — hero + a scroll-TRIGGERED (not scroll-linked) two
 * stage reveal into Section 02.
 *
 * This used to be one scrubbed ScrollTrigger timeline mapping scroll position
 * 1:1 to progress (partial scroll = partial animation, reversible by
 * scrolling back). It's now two independent, fixed-duration, one-shot GSAP
 * timelines fired by discrete scroll GESTURES rather than driven by scroll
 * position:
 *
 *   Stage A (flood, STAGE_A_DURATION ≈ 1.2s): the first wheel/touch input
 *     at rest plays the blob spread + REJOX outline→solid-white crossfade
 *     (+ height settle) + label/rule/sentence color + Login pill inversion
 *     to full completion, regardless of whether the user keeps scrolling or
 *     stops immediately. Every sub-tween keeps the exact same relative
 *     start/duration proportions it had under the old scrubbed timeline —
 *     they were already expressed as fractions of a 0→d span, so porting
 *     them just means swapping that span's unit from "fraction of scroll
 *     progress" to "fraction of STAGE_A_DURATION seconds". The choreography
 *     is unchanged; only what drives it is.
 *   Stage B (overlap reveal, STAGE_B_DURATION = 1s): only once Stage A has
 *     fully completed does the NEXT scroll input play Section 02's
 *     slide-up-to-cover-hero to completion, same one-shot fixed-duration
 *     approach.
 *
 * Trigger + lock mechanism: a persistent `wheel`/`touchstart`/`touchmove`
 * listener pair on `window`, not GSAP ScrollTrigger. ScrollTrigger's
 * onEnter/toggleActions lifecycle is built around real scroll position
 * crossing a marker — it doesn't give the fine-grained "swallow every input
 * during this specific 1.2s, then listen for exactly one more gesture,
 * directionally" control this needs, so a small manual state machine
 * (`Stage` below) is a better fit. `home` has a fixed height:100vh and both
 * the hero and Section 02 are absolutely-positioned overlays inside it (as
 * before) — there is no real extra document height to scroll into during
 * the two-stage sequence, so every "scroll" here is virtual: we
 * preventDefault the input and react to its direction/magnitude, rather
 * than reading real scrollTop. `document.documentElement`/`body` also get
 * `overflow: hidden` for the ~1.2s / ~1s a timeline is actively playing, as
 * a second, CSS-level guarantee against any scroll (incl. keyboard/
 * scrollbar-drag) leaking through mid-animation — belt and suspenders with
 * the preventDefault calls, which are what actually gate the *triggering*
 * logic.
 *
 * Reverse/reset: proper reverse-PLAY (`tl.reverse()`), not an instant
 * `pause(0)` cut. Each timeline gets its own reverse counterpart state
 * (`reverseA/reverseB`) so a reverse gesture is treated exactly like a
 * forward one — a fixed-duration, eased, one-shot animation that swallows
 * further input until it finishes (`onReverseComplete`, GSAP's mirror of
 * `onComplete`). The one deliberate asymmetry: a reverse gesture during an
 * ACTIVE forward play (`stageA`/`stageB`) is NOT swallowed — it interrupts
 * and reverses from wherever the timeline currently sits, via plain
 * `tl.reverse()` with no `.pause(0)`/`.seek()` beforehand. GSAP's reverse()
 * is direction-aware and mid-flight-safe by design (it reverses from the
 * timeline's current position, not from its end), so this "just works" as
 * long as nothing forces the playhead to a fixed spot first — which is
 * exactly the bug the old `pause(0)`-based reset had. The same
 * interruptibility works the other way too: a forward gesture during
 * `reverseA`/`reverseB` calls `tl.play()` (no `(0)` — resumes from the
 * current position) to flip back to forward from wherever the reverse had
 * gotten to.
 *
 * The header is a THIRD sibling of the hero and Section 02 (not nested
 * inside either), `position: fixed`, z-index above both (z50 vs hero z1 /
 * Section 02 z2) — nesting it inside `.rx-hero` would trap it under that
 * element's own stacking context, so no z-index on the header could ever
 * lift it above Section 02 once that panel covers the screen. `.rx-mid`
 * carries a compensating margin-top (39.5px) so the header being fixed
 * (removed from `.rx-frame`'s flex flow) doesn't shift the left content
 * block that used to sit below it.
 *
 * prefers-reduced-motion: no timelines, no listeners, no lock. The static
 * rest hero renders, with Section 02 stacked normally below it (the default
 * document flow); the header stays fixed regardless, since that's
 * independent of the animation. Everything is scoped under `.rx-home`; the
 * /app workflow is untouched.
 */

const NAV_ITEMS = ['Home', 'About', 'Docs', 'Features']

const BLACK = '#050505'
const WHITE = '#ffffff'

/** Stage A (flood + inversions): fixed duration, one-shot, not scrubbed. */
const STAGE_A_DURATION = 1.2
/** Stage B (Section 02 slide-up): fixed duration, one-shot, not scrubbed. */
const STAGE_B_DURATION = 1

/** Extra px Section 02 travels past yPercent 0, so its rounded top corners
 * (and the matching extra height added in Home.css) scroll fully out of view. */
const SECTION2_OVERSHOOT_PX = 56

/** Minimum |delta| (wheel deltaY, or touch px moved) to count as a deliberate
 * scroll gesture rather than noise — deliberately small so "the first
 * wheel/touch delta" triggers immediately, not after a large swipe. */
const GESTURE_THRESHOLD = 2

/** Four hand-authored organic blob outlines (closed Catmull-Rom splines
 * through a perturbed circle, viewBox 0 0 200 200) — irregular, non-circular
 * edges without any SVG filter. Reused across the 6 placed instances below. */
const BLOB_PATHS = [
  'M170.73,100.00 C165.63,113.03 157.65,118.94 152.39,130.25 C147.14,141.56 147.92,159.40 139.18,167.87 C130.45,176.34 113.92,179.61 100.00,181.09 C86.08,182.57 66.59,183.97 55.69,176.74 C44.80,169.51 40.85,150.52 34.65,137.73 C28.45,124.94 18.65,112.66 18.50,100.00 C18.36,87.34 25.41,70.78 33.80,61.78 C42.19,52.78 57.79,52.75 68.83,46.01 C79.86,39.26 87.60,24.80 100.00,21.32 C112.40,17.84 129.39,20.00 143.22,25.13 C157.06,30.26 178.41,39.61 182.99,52.09 C187.57,64.56 175.83,86.97 170.73,100.00 Z',
  'M179.07,100.00 C179.12,114.00 179.03,129.85 172.92,142.10 C166.81,154.35 154.59,167.84 142.43,173.50 C130.28,179.16 112.80,178.39 100.00,176.06 C87.20,173.73 74.70,166.95 65.65,159.50 C56.59,152.05 54.87,141.28 45.68,131.36 C36.49,121.44 14.99,113.04 10.51,100.00 C6.02,86.96 10.57,64.73 18.77,53.10 C26.97,41.47 46.18,33.64 59.72,30.23 C73.25,26.81 87.84,30.42 100.00,32.62 C112.16,34.83 120.55,39.21 132.65,43.45 C144.75,47.70 164.87,48.65 172.61,58.08 C180.35,67.50 179.02,86.00 179.07,100.00 Z',
  'M189.17,100.00 C186.72,113.48 170.89,124.65 162.70,136.20 C154.51,147.75 150.47,163.77 140.02,169.31 C129.57,174.86 112.50,170.94 100.00,169.48 C87.50,168.03 76.46,165.56 65.02,160.59 C53.58,155.61 40.55,149.72 31.37,139.63 C22.18,129.53 12.07,114.46 9.90,100.00 C7.74,85.54 8.64,62.02 18.38,52.88 C28.12,43.74 54.73,47.84 68.33,45.15 C81.94,42.46 88.44,38.49 100.00,36.75 C111.56,35.01 124.80,31.61 137.70,34.70 C150.60,37.80 168.82,44.43 177.40,55.31 C185.98,66.19 191.63,86.52 189.17,100.00 Z',
  'M180.37,100.00 C178.40,114.11 174.84,128.56 167.43,138.93 C160.02,149.30 147.17,155.52 135.93,162.23 C124.69,168.94 112.14,178.89 100.00,179.18 C87.86,179.46 73.69,171.02 63.08,163.95 C52.48,156.87 45.28,147.40 36.37,136.74 C27.46,126.08 11.13,113.12 9.62,100.00 C8.12,86.88 18.54,68.89 27.33,58.05 C36.13,47.20 50.31,38.26 62.42,34.91 C74.53,31.56 87.37,38.11 100.00,37.93 C112.63,37.75 124.99,31.12 138.20,33.84 C151.40,36.56 172.22,43.22 179.25,54.25 C186.27,65.27 182.34,85.89 180.37,100.00 Z',
]

/** Placement (className, matches Home.css — each has a fixed off-screen
 * center point beyond a hero edge/corner, not the middle) + which outline +
 * staggered [startFrac, endFrac] window (fractions of STAGE_A_DURATION) each
 * blob grows across. Staggered/uneven on purpose — not lockstep — but all
 * finish comfortably before the end of Stage A so the field reads solid. */
const BLOBS = [
  { cls: 'rx-blob-1', path: 0, start: 0.0, end: 0.6 }, // top-left corner
  { cls: 'rx-blob-2', path: 1, start: 0.06, end: 0.66 }, // top-right corner
  { cls: 'rx-blob-3', path: 2, start: 0.1, end: 0.72 }, // bottom-left corner
  { cls: 'rx-blob-4', path: 3, start: 0.03, end: 0.62 }, // bottom-right corner
  { cls: 'rx-blob-5', path: 1, start: 0.14, end: 0.78 }, // top edge, mid
  { cls: 'rx-blob-6', path: 3, start: 0.08, end: 0.7 }, // bottom edge, mid
  { cls: 'rx-blob-7', path: 2, start: 0.12, end: 0.74 }, // left edge, mid
  { cls: 'rx-blob-8', path: 0, start: 0.16, end: 0.76 }, // right edge, mid
] as const

/** The scroll-gesture state machine.
 * - 'rest' / 'betweenAB' / 'done': idle waypoints. A down-gesture here
 *   starts the next stage forward; an up-gesture (where meaningful) starts
 *   the previous stage's reverse.
 * - 'stageA' / 'stageB': that timeline is playing forward. A down-gesture
 *   is swallowed (can't skip ahead); an up-gesture INTERRUPTS and reverses
 *   it from its current position (tl.reverse(), no seek/pause first).
 * - 'reverseA' / 'reverseB': that timeline is playing in reverse. An
 *   up-gesture is swallowed (can't skip ahead in reverse either); a
 *   down-gesture interrupts and resumes forward from the current position
 *   (tl.play(), no arg — NOT tl.play(0), which would restart from 0). */
type Stage = 'rest' | 'stageA' | 'reverseA' | 'betweenAB' | 'stageB' | 'reverseB' | 'done'

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

    // Respect reduced-motion: no timelines, no listeners, no scroll-lock.
    // Leave the default flow — static rest hero with Section 02 stacked
    // below it.
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return

    let onWheel: (e: WheelEvent) => void = () => {}
    let onTouchStart: (e: TouchEvent) => void = () => {}
    let onTouchMove: (e: TouchEvent) => void = () => {}

    const ctx = gsap.context(() => {
      // Motion layout: the stage is exactly one viewport; the hero and
      // Section 02 become stacked full-bleed layers within it. Section 02
      // starts fully below the fold (yPercent 100) and above the hero (z2).
      // No ScrollTrigger/pin: `home` simply has a fixed height, so there's
      // no real extra document height for the two-stage sequence to need —
      // it's driven entirely by the gesture listeners below.
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

      // ---- Stage A: the flood + REJOX crossfade + color inversions. Same
      // choreography as the old scrubbed Phase 1, just re-timed from
      // "fraction of scroll progress" to "fraction of STAGE_A_DURATION", and
      // re-eased (was flat `ease:'none'` throughout, i.e. linear — read as
      // mechanical). Blobs keep their own distinct ease: they're a
      // DIFFERENT visual language (irregular, staggered ink emerging), not
      // meant to feel synced with each other. power1.out → power2.out for a
      // more confident, organic deceleration as each blob settles into its
      // final shape. Everything else here — the wordmark's fill+scaleY, the
      // label/rule/sentence colors, and the Login pill's inversion — reacts
      // to the SAME underlying event (the world going orange) and shares
      // identical duration/start/ease (power2.inOut) so they read as one
      // cohesive wave rather than several similar-but-not-quite-synced
      // tweens; only the shared curve changed from a mechanical straight
      // line to a smooth accelerate-then-settle S-curve. ----
      const tlA = gsap.timeline({ paused: true, defaults: { ease: 'none' } })
      for (const b of BLOBS) {
        tlA.fromTo(
          `.${b.cls}`,
          { scale: 0 },
          { scale: 1, duration: (b.end - b.start) * STAGE_A_DURATION, ease: 'power2.out' },
          b.start * STAGE_A_DURATION,
        )
      }
      tlA.to('.rx-wordmark-fill', { opacity: 1, duration: STAGE_A_DURATION, ease: 'power2.inOut' }, 0)
      tlA.to('.rx-wordmark', { scaleY: 1, duration: STAGE_A_DURATION, ease: 'power2.inOut' }, 0)
      tlA.to('.rx-label', { color: WHITE, duration: STAGE_A_DURATION, ease: 'power2.inOut' }, 0)
      tlA.to('.rx-rule', { backgroundColor: WHITE, duration: STAGE_A_DURATION, ease: 'power2.inOut' }, 0)
      tlA.to('.rx-sentence', { color: WHITE, duration: STAGE_A_DURATION, ease: 'power2.inOut' }, 0)
      // Nav items and the hero "Start migration" button/chip are
      // intentionally NOT tweened — their color is locked to one fixed
      // scheme at every point in the sequence.
      tlA.to(
        '.rx-cta-pill',
        {
          backgroundColor: BLACK,
          color: WHITE,
          boxShadow: '0 6px 18px rgba(0,0,0,0.3)',
          duration: STAGE_A_DURATION,
          ease: 'power2.inOut',
        },
        0,
      )

      // ---- Stage B: Section 02 slides up over the fixed hero. Same
      // yPercent/y overshoot technique as before, just its own independent
      // fixed-duration timeline instead of the tail end of a shared one.
      // power3.out: a strong, confident deceleration into place for a
      // panel this large — no overshoot (power eases never overshoot by
      // construction), which is what "confident arrival" calls for here. ----
      const tlB = gsap.timeline({ paused: true, defaults: { ease: 'none' } })
      tlB.to(section2, {
        yPercent: 0,
        y: -SECTION2_OVERSHOOT_PX,
        duration: STAGE_B_DURATION,
        ease: 'power3.out',
      })

      let stage: Stage = 'rest'

      const lock = () => {
        document.documentElement.style.overflow = 'hidden'
        document.body.style.overflow = 'hidden'
      }
      const unlock = () => {
        document.documentElement.style.overflow = ''
        document.body.style.overflow = ''
      }

      tlA.eventCallback('onComplete', () => {
        stage = 'betweenAB'
        unlock()
      })
      tlA.eventCallback('onReverseComplete', () => {
        stage = 'rest'
        unlock()
      })
      tlB.eventCallback('onComplete', () => {
        stage = 'done'
        unlock()
      })
      tlB.eventCallback('onReverseComplete', () => {
        stage = 'betweenAB'
        unlock()
      })

      function handleGesture(delta: number, e: Event) {
        const down = delta > GESTURE_THRESHOLD
        const up = delta < -GESTURE_THRESHOLD

        if (stage === 'stageA') {
          // Forward-playing: a further down-gesture can't skip ahead, but
          // an up-gesture interrupts and reverses cleanly from wherever the
          // timeline currently is — plain tl.reverse(), no seek first.
          if (up) {
            e.preventDefault()
            stage = 'reverseA'
            tlA.reverse()
          } else if (down) {
            e.preventDefault()
          }
          return
        }
        if (stage === 'reverseA') {
          // Reverse-playing: symmetric to the above — a down-gesture
          // interrupts and resumes forward from the current position
          // (tl.play(), NOT tl.play(0)).
          if (down) {
            e.preventDefault()
            stage = 'stageA'
            tlA.play()
          } else if (up) {
            e.preventDefault()
          }
          return
        }
        if (stage === 'stageB') {
          if (up) {
            e.preventDefault()
            stage = 'reverseB'
            tlB.reverse()
          } else if (down) {
            e.preventDefault()
          }
          return
        }
        if (stage === 'reverseB') {
          if (down) {
            e.preventDefault()
            stage = 'stageB'
            tlB.play()
          } else if (up) {
            e.preventDefault()
          }
          return
        }
        if (stage === 'rest') {
          if (down) {
            e.preventDefault()
            stage = 'stageA'
            lock()
            tlA.play(0)
          }
          return
        }
        if (stage === 'betweenAB') {
          if (down) {
            e.preventDefault()
            stage = 'stageB'
            lock()
            tlB.play(0)
          } else if (up) {
            e.preventDefault()
            stage = 'reverseA'
            lock() // betweenAB is unlocked at rest; re-lock, we're animating again
            tlA.reverse()
          }
          return
        }
        // stage === 'done': only intercept an upward gesture at the very
        // top (reversing Section 02 back down); otherwise let normal
        // scrolling happen (there's nothing to scroll into yet in
        // Section 02, but this keeps the mechanism correct if that
        // changes later).
        if (stage === 'done' && up && window.scrollY <= 0) {
          e.preventDefault()
          stage = 'reverseB'
          lock()
          tlB.reverse()
        }
      }

      onWheel = (e) => handleGesture(e.deltaY, e)

      let touchStartY = 0
      onTouchStart = (e) => {
        touchStartY = e.touches[0].clientY
      }
      onTouchMove = (e) => {
        // touchStartY − currentY: finger moving up (content scrolling down)
        // is positive, matching wheel's deltaY sign convention.
        handleGesture(touchStartY - e.touches[0].clientY, e)
      }

      window.addEventListener('wheel', onWheel, { passive: false })
      window.addEventListener('touchstart', onTouchStart, { passive: true })
      window.addEventListener('touchmove', onTouchMove, { passive: false })
    }, home)

    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      document.documentElement.style.overflow = ''
      document.body.style.overflow = ''
      ctx.revert()
    }
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
