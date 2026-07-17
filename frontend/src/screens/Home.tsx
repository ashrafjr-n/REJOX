import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

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
 * Project Intelligence — the live "watch Rejox analyze" scene that flows
 * directly below the hero (this replaces the old empty Section 02).
 *
 * It is NOT a static info block: it plays ONCE, triggered the first time the
 * section scrolls into view, then stops permanently — it never loops and
 * never restarts on subsequent scroll-ins. The only motion that persists
 * after the sequence ends is the small "live" status dot on the dashboard
 * panel bar (a generic "system is live" indicator, not part of the reveal).
 *
 * Sequencing model — a single async `run()` walks the story top to bottom:
 * upload bar fill -> typed "uploaded" line -> the file tree, one line at a
 * time with a real character-by-character typewriter effect (a blinking
 * cursor rides the END of whichever line is currently typing, and only while
 * something is actively typing) -> counted-up stat numbers synced to the
 * line that revealed them -> "Project Intelligence Complete" -> a synced
 * count-up + fill of the readiness bar -> a warning line -> a one-shot
 * "Knowledge Graph Built" flash above the terminal that fades in, holds
 * briefly, fades out, and never reappears.
 *
 * Causal tree -> card sync — each dashboard stat card mounts shortly AFTER
 * its triggering tree line finishes typing (and, for Pages/Components,
 * after their number finishes counting up), so the reveal reads as *caused
 * by* the detection. A thin one-shot "beam" is drawn from the terminal's
 * right edge to each card the instant it mounts (measured via
 * getBoundingClientRect against the live two-panel wrapper), reinforcing
 * that the dashboard is fed by what the terminal just found.
 *
 * Fixed facts — every number/name below (142 Components, 37 Pages, React 19,
 * Tailwind, Zustand, Axios, Framer Motion, 96% readiness) is a hard-coded
 * constant describing the SAME one sample project.
 *
 * Performance — `prefers-reduced-motion` skips straight to the fully
 * resolved frame (no typing, no counting, no flash, no beams).
 * ==========================================================================*/

const PI_SAMPLE = 'sample-app'

/* Fixed, consistent facts about the ONE sample project — never randomized. */
const PI_READINESS = 96

/* Tree children, in the exact order Project |-- Pages ... `-- Routing.
   `dot` flags the nodes whose detection triggers a stat reveal on the right,
   so the causal link is legible in the tree itself. `count` drives a synced
   count-up badge for the two nodes that carry a number. */
const PI_TREE: { id: string; label: string; count?: number; dot?: boolean }[] = [
  { id: 'pages', label: 'Pages', count: 37, dot: true },
  { id: 'components', label: 'Components', count: 142, dot: true },
  { id: 'hooks', label: 'Hooks', dot: true },
  { id: 'apis', label: 'APIs' },
  { id: 'assets', label: 'Assets' },
  { id: 'libraries', label: 'Libraries', dot: true },
  { id: 'routing', label: 'Routing' },
]

/* The four detected libraries, each with its own staggered reveal. */
const PI_LIBS = [
  { id: 'tailwind', label: 'Tailwind' },
  { id: 'zustand', label: 'Zustand' },
  { id: 'axios', label: 'Axios' },
  { id: 'framer', label: 'Framer Motion' },
] as const

/* Timing constants for the one-shot sequence (ms). */
const PI_UPLOAD_MS = 460
const PI_CHAR_MS = 17
const PI_COUNT_MS = 500
const PI_NODE_PAUSE_MS = 160
const PI_LIB_STAGGER_MS = 130
const PI_READY_MS = 900
const PI_CARD_DELAY_MS = 90

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

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 12.5 9.5 18 20 6.5"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function piWait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/* Types `text` into `onUpdate` one character at a time. Checks `cancelled`
   after every await so an unmount/reduced-motion switch mid-sequence stops
   cleanly instead of continuing to write into stale state. */
async function piType(
  text: string,
  onUpdate: (partial: string) => void,
  charMs: number,
  cancelled: { current: boolean }
) {
  for (let i = 1; i <= text.length; i++) {
    if (cancelled.current) return
    onUpdate(text.slice(0, i))
    if (i < text.length) await piWait(charMs)
  }
}

function piEaseOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

/* Counts 0 -> target over durationMs via rAF (eased), independent of the
   chained-setTimeout driver so it stays smooth regardless of tab throttling. */
function piCountUp(
  target: number,
  durationMs: number,
  onUpdate: (n: number) => void,
  cancelled: { current: boolean }
): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now()
    function frame(now: number) {
      if (cancelled.current) return resolve()
      const t = Math.min(1, (now - start) / durationMs)
      onUpdate(Math.round(target * piEaseOutCubic(t)))
      if (t < 1) requestAnimationFrame(frame)
      else resolve()
    }
    requestAnimationFrame(frame)
  })
}

type PiBeam = { id: string; top: number; left: number; width: number }

function ProjectIntelligence() {
  const sectionRef = useRef<HTMLElement | null>(null)
  const piInnerRef = useRef<HTMLDivElement | null>(null)
  const liveRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<HTMLDivElement | null>(null)
  const beamedRef = useRef<Set<string>>(new Set())
  const reduced = usePrefersReducedMotion()
  const [started, setStarted] = useState(false)

  const [uploading, setUploading] = useState(true)
  const [uploadTyped, setUploadTyped] = useState('')
  const [rootOn, setRootOn] = useState(false)
  const [nodeTyped, setNodeTyped] = useState<Record<string, string>>({})
  const [nodeCount, setNodeCount] = useState<Record<string, number>>({})
  const [activeLine, setActiveLine] = useState<string | null>(null)
  const [completeTyped, setCompleteTyped] = useState('')
  const [readinessOn, setReadinessOn] = useState(false)
  const [readinessPct, setReadinessPct] = useState(0)
  const [warnTyped, setWarnTyped] = useState('')
  const [cardOn, setCardOn] = useState<Record<string, boolean>>({})
  const [flash, setFlash] = useState<'hidden' | 'visible' | 'gone'>('hidden')
  const [beams, setBeams] = useState<PiBeam[]>([])

  /* Scroll-driven entrance/exit for the whole live-analysis card — tilt-in
     entrance (rotate baseRotation->0) with opacity + blur in, then a straight
     fade/blur out on exit (NO rotation). Applied to the OUTER .rx-pi-inner
     wrapper. Skipped under reduced-motion (content stays fully visible). */
  useEffect(() => {
    const el = piInnerRef.current
    if (!el || reduced) return
    const baseOpacity = 0
    const baseRotation = 3
    const blurStrength = 10
    const ctx = gsap.context(() => {
      const revealTrigger = {
        trigger: el,
        start: 'top bottom',
        end: 'top center',
        scrub: true,
      }
      gsap.fromTo(
        el,
        {
          transformOrigin: '0% 50%',
          rotate: baseRotation,
          opacity: baseOpacity,
          filter: `blur(${blurStrength}px)`,
        },
        {
          ease: 'none',
          rotate: 0,
          opacity: 1,
          filter: 'blur(0px)',
          scrollTrigger: revealTrigger,
        }
      )
      gsap.to(el, {
        ease: 'none',
        opacity: baseOpacity,
        filter: `blur(${blurStrength}px)`,
        immediateRender: false,
        scrollTrigger: { trigger: el, start: 'top 20%', end: '+=50%', scrub: true },
      })
    }, el)
    return () => ctx.revert()
  }, [reduced])

  /* Trigger the sequence exactly once, the first time the section scrolls
     into view — then disconnect so it can never fire again. */
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        console.log('[PI] IO fired, isIntersecting=', entry.isIntersecting, 'ratio=', entry.intersectionRatio)
        if (entry.isIntersecting) {
          setStarted(true)
          io.disconnect()
        }
      },
      { threshold: 0.25 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  /* Draw a one-shot thin beam from the terminal's right edge to a dashboard
     card's left edge, measured against the live two-panel wrapper so it
     lands correctly regardless of viewport width. Skipped under reduced
     motion and guarded so each card only ever spawns one beam. */
  const spawnBeam = (id: string, cardEl: HTMLElement) => {
    if (reduced || beamedRef.current.has(id)) return
    const liveEl = liveRef.current
    const termEl = terminalRef.current
    if (!liveEl || !termEl) return
    const liveBox = liveEl.getBoundingClientRect()
    const termBox = termEl.getBoundingClientRect()
    const cardBox = cardEl.getBoundingClientRect()
    const width = Math.round(cardBox.left - termBox.right)
    if (width < 4) return
    beamedRef.current.add(id)
    setBeams((b) => [
      ...b,
      {
        id,
        top: Math.round(cardBox.top + cardBox.height / 2 - liveBox.top),
        left: Math.round(termBox.right - liveBox.left),
        width,
      },
    ])
  }

  /* The one-shot driver. reduced-motion => jump straight to the finished
     frame with no animation, no flash, no beams. Otherwise walk the story
     once with a single cancellable async function; nothing ever resets. */
  useEffect(() => {
    console.log('[PI] driver effect fired, started=', started, 'reduced=', reduced)
    if (!started) return

    if (reduced) {
      setUploading(false)
      setUploadTyped(`${PI_SAMPLE}.zip uploaded`)
      setRootOn(true)
      setNodeTyped(Object.fromEntries(PI_TREE.map((n) => [n.id, n.label])))
      setNodeCount(
        Object.fromEntries(
          PI_TREE.filter((n): n is typeof n & { count: number } => typeof n.count === 'number').map(
            (n) => [n.id, n.count]
          )
        )
      )
      setCardOn({
        pages: true,
        components: true,
        react: true,
        libraries: true,
        tailwind: true,
        zustand: true,
        axios: true,
        framer: true,
      })
      setCompleteTyped('Project Intelligence Complete')
      setReadinessOn(true)
      setReadinessPct(PI_READINESS)
      setWarnTyped('2 unsupported libraries detected')
      setActiveLine(null)
      setFlash('gone')
      return
    }

    const cancelled = { current: false }
    ;(window as any).__piRuns = ((window as any).__piRuns ?? 0) + 1
    const runId = (window as any).__piRuns
    console.log('[PI] run start', runId)

    async function run() {
      try {
      await piWait(400)
      console.log('[PI] after 400 wait', runId, 'cancelled=', cancelled.current)
      if (cancelled.current) return

      // Upload progress track fills via its own CSS animation (0.46s); wait
      // for it to visually resolve before flipping to the "uploaded" state.
      await piWait(PI_UPLOAD_MS)
      console.log('[PI] after upload wait', runId)
      if (cancelled.current) return
      setUploading(false)
      setActiveLine('upload')
      await piType(`${PI_SAMPLE}.zip uploaded`, setUploadTyped, PI_CHAR_MS, cancelled)
      if (cancelled.current) return

      await piWait(240)
      if (cancelled.current) return
      setRootOn(true)
      setActiveLine(null)
      await piWait(200)
      if (cancelled.current) return

      for (const node of PI_TREE) {
        setActiveLine(node.id)
        setNodeTyped((s) => ({ ...s, [node.id]: '' }))
        await piType(
          node.label,
          (partial) => setNodeTyped((s) => ({ ...s, [node.id]: partial })),
          PI_CHAR_MS,
          cancelled
        )
        if (cancelled.current) return

        if (typeof node.count === 'number') {
          setNodeCount((s) => ({ ...s, [node.id]: 0 }))
          await piCountUp(
            node.count,
            PI_COUNT_MS,
            (n) => setNodeCount((s) => ({ ...s, [node.id]: n })),
            cancelled
          )
          if (cancelled.current) return
        }

        if (node.id === 'pages' || node.id === 'components' || node.id === 'hooks') {
          await piWait(PI_CARD_DELAY_MS)
          if (cancelled.current) return
          setCardOn((s) => ({ ...s, [node.id === 'hooks' ? 'react' : node.id]: true }))
        } else if (node.id === 'libraries') {
          setCardOn((s) => ({ ...s, libraries: true }))
          for (const lib of PI_LIBS) {
            await piWait(PI_LIB_STAGGER_MS)
            if (cancelled.current) return
            setCardOn((s) => ({ ...s, [lib.id]: true }))
          }
        }

        await piWait(PI_NODE_PAUSE_MS)
        if (cancelled.current) return
      }

      setActiveLine('complete')
      await piType('Project Intelligence Complete', setCompleteTyped, PI_CHAR_MS, cancelled)
      if (cancelled.current) return

      await piWait(260)
      if (cancelled.current) return
      setReadinessOn(true)
      await piCountUp(PI_READINESS, PI_READY_MS, setReadinessPct, cancelled)
      if (cancelled.current) return

      await piWait(180)
      if (cancelled.current) return
      setActiveLine('warn')
      await piType('2 unsupported libraries detected', setWarnTyped, PI_CHAR_MS, cancelled)
      if (cancelled.current) return
      setActiveLine(null)

      await piWait(320)
      if (cancelled.current) return
      setFlash('visible')
      } catch (err) {
        console.error('[PI] run() threw', err)
      }
    }

    run()
    return () => {
      cancelled.current = true
    }
  }, [started, reduced])

  return (
    <>
      {/* Standalone full-viewport intro — the "Project Intelligence" moment,
          scrolled FIRST, before the live-analysis (terminal/tree/dashboard)
          section below. Background is left transparent so the page's pure-black
          base shows through, untouched. */}
      <section className="rx-piIntro" aria-label="Project Intelligence">
        <div className="rx-piIntro-inner">
          {/* Eyebrow label — now rides the SAME ScrollReveal entrance/exit as the
              headline + paragraph below (tilt-in entrance, straight fade/blur
              exit). The decorative rule is a ::before on the first word so it
              fades/blurs in perfect sync with the label rather than sitting
              static. See .rx-piIntro-eyebrow* in Home.css. */}
          <ScrollReveal
            containerClassName="rx-piIntro-reveal rx-piIntro-eyebrow"
            textClassName="rx-piIntro-eyebrow-p"
            baseOpacity={0}
            baseRotation={4}
            blurStrength={10}
            enableBlur
          >
            Project Intelligence
          </ScrollReveal>
          {/* Headline + paragraph reveal word-by-word (blur/opacity/rotation)
              as this section scrolls into view — see ScrollReveal, used exactly
              as provided. Sized up (Clash Display, hero-weight) to override
              ScrollReveal's small default clamp. */}
          <ScrollReveal
            containerClassName="rx-piIntro-reveal rx-piIntro-copy"
            textClassName="rx-piIntro-copy-p rx-piIntro-oneline"
            baseOpacity={0}
            baseRotation={4}
            blurStrength={10}
            enableBlur
          >
            Upload your React project.
          </ScrollReveal>
          <ScrollReveal
            containerClassName="rx-piIntro-reveal rx-piIntro-copy"
            textClassName="rx-piIntro-copy-p"
            baseOpacity={0}
            baseRotation={3}
            blurStrength={10}
            enableBlur
          >
            Rejox builds a deterministic knowledge graph of your codebase — every page, component, hook and dependency — before a single line is migrated.
          </ScrollReveal>
        </div>
      </section>

      {/* Live-analysis section — the terminal/tree/dashboard. Flows after the
          intro in scroll order. Keeps the IntersectionObserver ref so the
          one-shot sequence starts the first time it scrolls into view. */}
      <section
        ref={sectionRef}
        className="rx-section2 rx-pi"
        aria-label="Project Intelligence Analysis"
      >
      <div className="rx-pi-inner" ref={piInnerRef}>
        <div className="rx-pi-live" ref={liveRef}>
          {/* One-shot "Knowledge Graph Built" flash — appears above the
              terminal only once, right after the typing sequence finishes,
              fades in/out over ~1s, then is removed from the DOM for good. */}
          {flash === 'visible' && (
            <div
              className="rx-pi-flash"
              onAnimationEnd={() => setFlash('gone')}
            >
              <CheckGlyph />
              Knowledge Graph Built
            </div>
          )}

          {/* Thin one-shot beams from the terminal's right edge to each
              dashboard card, drawn the instant that card mounts. */}
          <div className="rx-pi-wire" aria-hidden="true">
            {beams.map((b) => (
              <span
                key={b.id}
                className="rx-pi-beam"
                style={{ top: b.top, left: b.left, width: b.width }}
              />
            ))}
          </div>

          {/* LEFT — terminal / code-editor window: a chromed panel (window-control
              dots + filename) whose monospace body streams the live analysis:
              upload -> tree build (line by line, real character-by-character
              typing, blinking cursor on the active line only) -> Complete ->
              Readiness. */}
          <div className="rx-pi-scene rx-pi-panel rx-pi-terminal" ref={terminalRef}>
            <div className="rx-pi-panel-bar rx-pi-term-bar" aria-hidden="true">
              <span className="rx-pi-term-dots">
                <span className="rx-pi-term-dot" />
                <span className="rx-pi-term-dot" />
                <span className="rx-pi-term-dot" />
              </span>
              <span className="rx-pi-term-title">{PI_SAMPLE}.zip</span>
              <span className="rx-pi-term-tag">analysis</span>
            </div>
            <div className="rx-pi-panel-body rx-pi-term-body">
              <div className="rx-pi-upload">
                {uploading ? (
                  <>
                    <span className="rx-pi-upload-label">
                      Upload {PI_SAMPLE}.zip
                    </span>
                    <span className="rx-pi-upload-track" aria-hidden="true">
                      <span className="rx-pi-upload-fill" />
                    </span>
                  </>
                ) : (
                  <span className="rx-pi-upload-done">
                    <span className="rx-pi-upload-check" aria-hidden="true">
                      <CheckGlyph />
                    </span>
                    {uploadTyped}
                    {activeLine === 'upload' && (
                      <span className="rx-pi-cursor" aria-hidden="true" />
                    )}
                  </span>
                )}
              </div>

              <div className="rx-pi-tree" role="tree" aria-label="Project structure">
                {rootOn && (
                  <div className="rx-pi-node rx-pi-node-root">
                    <span className="rx-pi-node-label rx-pi-dir">Project</span>
                  </div>
                )}
                {PI_TREE.map((node, i) => {
                  const last = i === PI_TREE.length - 1
                  const typed = nodeTyped[node.id]
                  if (typed === undefined) return null
                  const done = typed === node.label
                  const count = nodeCount[node.id]
                  return (
                    <div key={node.id} className="rx-pi-node">
                      <span className="rx-pi-branch" aria-hidden="true">
                        {last ? '└──' : '├──'}
                      </span>
                      <span
                        className={
                          'rx-pi-node-label' +
                          (done ? ' rx-pi-dir' : '') +
                          (node.dot && done ? ' is-detected' : '')
                        }
                      >
                        {typed}
                      </span>
                      {count !== undefined && (
                        <span className="rx-pi-node-count">{count}</span>
                      )}
                      {activeLine === node.id && (
                        <span className="rx-pi-cursor" aria-hidden="true" />
                      )}
                    </div>
                  )
                })}
              </div>

              {completeTyped && (
                <div className="rx-pi-termline rx-pi-line-ok">
                  <span className="rx-pi-line-glyph" aria-hidden="true">
                    <CheckGlyph />
                  </span>
                  {completeTyped}
                  {activeLine === 'complete' && (
                    <span className="rx-pi-cursor" aria-hidden="true" />
                  )}
                </div>
              )}

              {readinessOn && (
                <div className="rx-pi-readiness">
                  <div className="rx-pi-readiness-top">
                    <span className="rx-pi-readiness-pct">{readinessPct}%</span>
                    <span className="rx-pi-readiness-label">
                      Migration Readiness
                    </span>
                  </div>
                  <div
                    className={'rx-pi-readiness-bar' + (reduced ? ' no-anim' : '')}
                    aria-hidden="true"
                  >
                    <span
                      className="rx-pi-readiness-fill"
                      style={reduced ? undefined : { transform: `scaleX(${readinessPct / 100})` }}
                    />
                  </div>
                  {warnTyped && (
                    <div className="rx-pi-termline rx-pi-line-warn">
                      <span className="rx-pi-line-glyph" aria-hidden="true">
                        !
                      </span>
                      {warnTyped}
                      {activeLine === 'warn' && (
                        <span className="rx-pi-cursor" aria-hidden="true" />
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT — dashboard panel: same panel chrome as the terminal (matching
              radius / border / shadow) so the two read as one console. A grid of
              stat cards, each mounted once its cause (a tree line + count, where
              applicable) has resolved. */}
          <div className="rx-pi-dash rx-pi-panel" aria-label="Detected project facts">
            <div className="rx-pi-panel-bar rx-pi-dash-bar" aria-hidden="true">
              <span className="rx-pi-live-dot" />
              <span className="rx-pi-dash-title">Project Analysis</span>
            </div>
            <div className="rx-pi-panel-body rx-pi-dash-body">
              <div className="rx-pi-stats">
                {cardOn.pages && (
                  <div
                    className="rx-pi-stat"
                    ref={(el) => el && spawnBeam('pages', el)}
                  >
                    <span className="rx-pi-stat-value">{nodeCount.pages ?? 37}</span>
                    <span className="rx-pi-stat-label">Pages</span>
                  </div>
                )}
                {cardOn.components && (
                  <div
                    className="rx-pi-stat"
                    ref={(el) => el && spawnBeam('components', el)}
                  >
                    <span className="rx-pi-stat-value">{nodeCount.components ?? 142}</span>
                    <span className="rx-pi-stat-label">Components</span>
                  </div>
                )}
                {cardOn.react && (
                  <div
                    className="rx-pi-stat rx-pi-stat-wide"
                    ref={(el) => el && spawnBeam('react', el)}
                  >
                    <span className="rx-pi-stat-label">Framework</span>
                    <span className="rx-pi-stat-fw">React 19</span>
                  </div>
                )}
                {cardOn.libraries && (
                  <div
                    className="rx-pi-stat rx-pi-stat-wide rx-pi-stat-libs"
                    ref={(el) => el && spawnBeam('libraries', el)}
                  >
                    <span className="rx-pi-stat-label">Libraries</span>
                    <div className="rx-pi-pills">
                      {PI_LIBS.map(
                        (lib) =>
                          cardOn[lib.id] && (
                            <span key={lib.id} className="rx-pi-pill">
                              {lib.label}
                            </span>
                          )
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      </section>
    </>
  )
}

/* ============================================================================
 * Migration Pipeline — a full-width horizontal timeline of the six migration
 * stages (Upload -> Understand -> Plan -> Ask -> Convert -> Validate), with a
 * glowing "energy" comet that travels continuously along the connecting line
 * through every stage and loops.
 *
 * Layout — a 6-column grid; each stage is a column whose circular marker is
 * centred inside a fixed-height slot, so all marker CENTRES land on one
 * horizontal line even though Understand/Convert are larger. The connecting
 * line + the pulse track are absolutely positioned at that centre line.
 *
 * The pulse — one GPU-only animation: an empty wrapper translated
 * translateX(0 -> 100cqw) across the track (container-query units keep it
 * responsive and composited), with an opacity keyframe that fades it in/out
 * only in the dim overshoot margins (0-5% / 95-100%). The six nodes sit at
 * 1/12..11/12 of the rail, so every node — including the two endpoints — gets a
 * full-bright pass, and the loop-back teleport happens while the comet is
 * invisible in the margin => a seamless continuous loop.
 *
 * Hierarchy — Understand and Convert carry Rejox's core value (deterministic
 * understanding + the actual transform), so their markers are visibly larger
 * and gradient-filled; the other four are smaller, dark, hairline-outlined.
 *
 * Performance — the animation is paused (`animation-play-state`) unless the
 * section is in view, via the same IntersectionObserver pattern as Project
 * Intelligence. `prefers-reduced-motion` hides the comet and shows a static,
 * fully-lit brand-gradient line as the settled state.
 * ==========================================================================*/

const PL_STAGES = [
  { id: 'upload', label: 'Upload', desc: 'Project in', big: false },
  { id: 'understand', label: 'Understand', desc: 'Knowledge graph', big: true },
  { id: 'plan', label: 'Plan', desc: 'Ordered plan', big: false },
  { id: 'ask', label: 'Ask', desc: 'Human decisions', big: false },
  { id: 'convert', label: 'Convert', desc: 'AST + AI transforms', big: true },
  { id: 'validate', label: 'Validate', desc: 'tsc + Metro', big: false },
] as const

/* Stroked 24-grid glyphs, one per stage — matched to the site's icon set. */
function PipelineIcon({ id }: { id: string }) {
  const paths: Record<string, React.ReactNode> = {
    upload: (
      <>
        <path d="M12 15V4" />
        <path d="M8 8l4-4 4 4" />
        <path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
      </>
    ),
    understand: (
      <>
        <circle cx="12" cy="6" r="2.1" />
        <circle cx="6" cy="17" r="2.1" />
        <circle cx="18" cy="17" r="2.1" />
        <path d="M11 7.6 7 15.2M13 7.6 17 15.2M8 17h8" />
      </>
    ),
    plan: (
      <>
        <path d="M9 6h11M9 12h11M9 18h11" />
        <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
      </>
    ),
    ask: (
      <>
        <path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
        <path d="M10.2 9.4a1.9 1.9 0 0 1 3.4 1.2c0 1.3-1.9 1.6-1.9 2.9M11.7 15.2h.01" />
      </>
    ),
    convert: (
      <>
        <path d="M4 9h13l-3.2-3.2" />
        <path d="M20 15H7l3.2 3.2" />
      </>
    ),
    validate: (
      <>
        <path d="M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6l7-3z" />
        <path d="M8.8 12l2.2 2.2 4-4.4" />
      </>
    ),
  }
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
      {paths[id]}
    </svg>
  )
}

function MigrationPipeline() {
  const sectionRef = useRef<HTMLElement | null>(null)
  const reduced = usePrefersReducedMotion()
  const [inView, setInView] = useState(false)

  /* Pause the pulse whenever the section is scrolled out of view. */
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.15 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const running = inView && !reduced

  return (
    <section
      ref={sectionRef}
      className={
        'rx-plsec' +
        (running ? ' is-running' : '') +
        (reduced ? ' is-reduced' : '')
      }
      aria-label="Migration Pipeline"
    >
      <div className="rx-pl-inner">
        <div className="rx-pl-head">
          <div className="rx-eyebrow">
            <span className="rx-rule" />
            <span className="rx-label">Migration Pipeline</span>
          </div>
          <h2 className="rx-pl-title">
            From React to React Native, in six stages.
          </h2>
        </div>

        <div className="rx-pl-rail">
          {/* connecting line (dim brand gradient) + the pulse track above it */}
          <div className="rx-pl-line" aria-hidden="true" />
          <div className="rx-pl-track" aria-hidden="true">
            <div className="rx-pl-pulse">
              <span className="rx-pl-pulse-core" />
            </div>
          </div>

          <ol className="rx-pl-stages">
            {PL_STAGES.map((stage, i) => (
              <li
                key={stage.id}
                className={'rx-pl-stage' + (stage.big ? ' is-big' : '')}
              >
                <span className="rx-pl-index" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="rx-pl-slot">
                  <div className="rx-pl-marker">
                    <PipelineIcon id={stage.id} />
                  </div>
                </div>
                <span className="rx-pl-label">{stage.label}</span>
                <span className="rx-pl-desc">{stage.desc}</span>
              </li>
            ))}
          </ol>
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

      {/* Section 02 — the live, looping Project Intelligence scene, flowing
          normally below the hero. */}
      <ProjectIntelligence />

      {/* Section 03 — the Migration Pipeline horizontal timeline. */}
      <MigrationPipeline />

      {/* Section 04 — the Analysis Dashboard (Coverage/Confidence/LLM + scoring). */}
      <AnalysisDashboard />
    </div>
  )
}
