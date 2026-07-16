import { motion } from 'framer-motion'

import './Home.css'
import BorderGlow from './BorderGlow'
import LightPillar from './LightPillar'
import rejoxLogo from '../assets/rejox-logo.svg'

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

      {/* Section 02 — a plain white section flowing normally below the hero. */}
      <section className="rx-section2" aria-label="Section 02" />
    </div>
  )
}
