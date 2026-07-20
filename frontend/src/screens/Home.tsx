import { motion } from 'framer-motion'

import './Home.css'
import BorderGlow from './BorderGlow'
import LightPillar from './LightPillar'
import ScrollReveal from './ScrollReveal'
import Understanding from './Understanding'
import Decisions from './Decisions'
import { SiteHeader } from '../components/SiteHeader'

/**
 * Rejox marketing home — a static hero followed by a closing call-to-action.
 *
 * The page scrolls naturally: the hero occupies one viewport and the closing
 * CTA flows directly below it in ordinary document order. There is no pinning,
 * no scroll-hijacking, and no scroll-driven color inversion — the earlier
 * scroll-triggered state machine and its GSAP timelines have been removed.
 *
 * The background is a WebGL "light pillar" (see LightPillar) rendered on a
 * `position: fixed`, full-viewport, `pointer-events: none` layer at the
 * `.rx-home` level (z-index 0, below the frame at z1 and the fixed header at
 * z50) with `screen` blend over the page's black base. Because it's one fixed
 * layer spanning the whole viewport — not clipped to the hero — there is no
 * seam where the hero meets the CTA: as the page scrolls the shader
 * *settles* (rotation slows, intensity fades, glow tightens; see
 * LightPillar's `scrollSettle`) and resolves to flat black by the time
 * the CTA fills the screen, so the animated hero background reads as one
 * continuous visual that calms into the CTA's dark background rather than
 * cutting off. At scrollY 0 the resting hero is unchanged. It degrades to a
 * fallback note where WebGL is unavailable. The only other motion is a
 * one-shot entrance fade/slide on mount (framer-motion), independent of scroll.
 *
 * The header is a fixed sibling of the hero and the closing CTA (not nested in
 * either), so it stays visible across the whole page. Everything is scoped
 * under `.rx-home`; the /app workflow is untouched.
 */

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

/* The Start-migration pill. Rendered identically in the hero and the closing
   CTA, so it lives in one place — a pure markup move: same element structure,
   class names, SVG and hover behaviour as the two former inline copies. */
function StartButton() {
  return (
    <button type="button" className="rx-start">
      <span className="rx-start-label">Start migration</span>
      <span className="rx-start-chip" aria-hidden="true">
        <ArrowRight />
      </span>
    </button>
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
 * Closing CTA — the page's final, full-viewport moment. A standalone text-only
 * section: the four-word summary of the flow ("Upload. / Wait. / Review. /
 * Ship.") reveals word-by-word via ScrollReveal as it scrolls into view, above
 * a reused Start-migration button.
 * ==========================================================================*/

function ClosingCta() {
  return (
    <>
      {/* Standalone full-viewport closing CTA, the last thing on the page.
          Background is left transparent so the page's pure-black base shows
          through, untouched. */}
      <section className="rx-cta" aria-label="Upload. Wait. Review. Ship.">
        <div className="rx-cta-inner rx-cta-stack">
          {/* Four-word summary of the whole flow — one word per line, each its
              own ScrollReveal so the section keeps its signature word-by-word
              blur/opacity/tilt reveal. Widened horizontally (scaleX, echoing the
              REJOX wordmark) rather than by font-size alone. */}
          {['Upload.', 'Wait.', 'Review.', 'Ship.'].map((word) => (
            <ScrollReveal
              key={word}
              containerClassName="rx-cta-reveal rx-cta-line"
              textClassName="rx-cta-word"
              baseOpacity={0}
              baseRotation={4}
              blurStrength={10}
              enableBlur
            >
              {word}
            </ScrollReveal>
          ))}
          {/* The same Start-migration button as the hero (shared StartButton
              component), centered below. */}
          <div className="rx-cta-actions">
            <StartButton />
          </div>
        </div>
      </section>
    </>
  )
}

/* ============================================================================
 * Footer — a quiet sign-off at the very bottom, after the CTA. Deliberately
 * minimal: the plain-text wordmark and a copyright line on one thin strip, the
 * least prominent thing on the page (lighter/smaller than the scenes'
 * attribution lines). Transparent background so the settled black shows through;
 * a single hairline above lets it settle without reading as its own section.
 * ==========================================================================*/
function SiteFooter() {
  return (
    <footer className="rx-footer">
      <span className="rx-footer-mark">rejox</span>
      <span className="rx-footer-copy">© 2026 All rights reserved.</span>
    </footer>
  )
}

export function Home() {
  return (
    <div className="rx-home">
      {/* WebGL light-pillar background — a single fixed, full-viewport layer
          behind everything (z-index 0, below the frame at z1 and the fixed
          header at z50). pointer-events:none so it never intercepts clicks.
          scrollSettle makes the shader calm and resolve to flat black as the
          page scrolls from the hero into the closing CTA, so there's no hard
          seam. Falls back to a "WebGL not supported" note if unavailable. */}
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

      {/* Floating capsule header (logo, nav, Login) — fixed to the viewport,
          sibling of both the hero and the closing CTA so it stays visible for
          the whole page. Shared with the other marketing pages so it stays
          identical everywhere; on `/` its logo scroll-to-top and Home active
          state behave exactly as before. */}
      <SiteHeader />

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
              <StartButton />
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

      {/* Scene 01 — "Understanding": the first scroll-driven section below the
          hero. Pinned; drives a beat index over three placeholder slots wired to
          real showcase.json figures. Sits between the hero and the closing CTA. */}
      <Understanding />

      {/* Scene 02 — "Decisions": how Rejox decides once it understands. Two beats
          (the one unknowable decision + the proof the rest was mechanical) joined
          by the whole-run LLM count. Reveal-on-scroll, not pinned. */}
      <Decisions />

      {/* Closing CTA — a four-word summary of the flow + START MIGRATION. */}
      <ClosingCta />

      {/* Footer — the quiet sign-off at the very bottom. */}
      <SiteFooter />
    </div>
  )
}
