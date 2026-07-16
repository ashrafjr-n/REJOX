import { motion } from 'framer-motion'

import './Home.css'
import rejoxLogo from '../assets/rejox-logo.png'

/**
 * Rejox marketing home — a static hero followed by a normal Section 02.
 *
 * The page scrolls naturally: the hero occupies one viewport and Section 02
 * flows directly below it in ordinary document order. There is no pinning, no
 * scroll-hijacking, no background flood / ink-blob animation, and no
 * scroll-driven color inversion — the earlier scroll-triggered state machine
 * and its GSAP timelines have been removed. The hero background is solid black
 * at every scroll position. The only motion is a one-shot entrance fade/slide
 * on mount (framer-motion), which is independent of scrolling.
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

export function Home() {
  return (
    <div className="rx-home">
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

      {/* Section 02 — a plain white section flowing normally below the hero. */}
      <section className="rx-section2" aria-label="Section 02" />
    </div>
  )
}
