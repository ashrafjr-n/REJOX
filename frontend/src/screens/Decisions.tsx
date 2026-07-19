import { useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { CustomEase } from 'gsap/CustomEase'

import './Decisions.css'
import showcase from '../data/showcase.json' with { type: 'json' }
import type { ShowcaseData } from '../types/showcase.generated'

/**
 * Scene 02 — "Only when needed".
 *
 * Answers the question Scene 01 raises: now that Rejox understands the project,
 * how does it DECIDE? ONE composition, read left → hinge → right:
 *
 *   Left   the one genuinely unknowable decision (the navigation shape the
 *          engine names in its question), shown with REAL provenance from the
 *          data — the title is never restated here. This is an AI proposal, NOT an
 *          analyzer finding — there is no formal Evidence object. Its provenance
 *          is what the model actually saw (the navbar + its links) and its own
 *          reasoning (the spec rationale), in reading order evidence → question →
 *          options so a visitor sees WHY before WHAT. The recommended option
 *          carries a quiet provenance marker (it came from the single assisted
 *          call) plus our own plain-language reason, marked as ours.
 *   Hinge  "AI was needed once." — the line that JOINS the two sides rather than
 *          separating them: the one call sits on the left, the mechanical proof
 *          on the right, and this is the pivot between them. The exact call
 *          count beneath the statement is read from the data, never written here.
 *   Right  the proof the rest was mechanical: tsc + Metro verdicts and the
 *          validated (working, compiles+bundles) headline in one row; the
 *          analyzer's conservative pre-migration prediction and the stricter
 *          residue-free figure kept visible in a quiet secondary treatment —
 *          both genuinely present, neither merged into the headline.
 *
 * Every value comes from showcase.json via the generated type; no figure, name,
 * or question text is hard-coded. Unlike Scene 01 this section is NOT pinned —
 * it's dense, revealed on scroll (restrained fade-up, house language). Its
 * ScrollTriggers are created inside a gsap.context scoped to the section, so
 * cleanup kills only its own triggers and it coexists with the Scene 01 pin and
 * the CTA's ScrollReveal. Reduced motion shows everything at once.
 *
 * Desktop only.
 */

gsap.registerPlugin(ScrollTrigger, CustomEase)

// The page's house easing — the exact cubic-bezier the hero entrances and the
// header transitions use (cubic-bezier(0.22, 1, 0.36, 1)) — so these reveals
// speak the same motion language as the rest of the page.
const HOUSE_EASE = CustomEase.create('rxHouse', 'M0,0 C0.22,1 0.36,1 1,1')

const data = showcase as ShowcaseData
const q = data.question
const ev = q.evidence
const r = data.results
const options = q.options ?? []
const navLinks = ev.topLevelLinks ?? []

const metroVerdict = r.metroPassed ? 'PASS' : r.metroRan ? 'FAIL' : 'SKIPPED'
const tscVerdict = r.tscPassed ? 'PASS' : 'FAIL'

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export default function Decisions() {
  const sectionRef = useRef<HTMLElement | null>(null)
  const [reduced] = useState(prefersReducedMotion)

  useLayoutEffect(() => {
    if (reduced) return
    const section = sectionRef.current
    if (!section) return

    // All triggers are created inside this context (scoped to the section), so
    // ctx.revert() on cleanup kills ONLY the triggers/tweens this section made —
    // never ScrollReveal's or the Scene 01 pin's. The plugin is registered in
    // this module; we rely on no other component's registration.
    const ctx = gsap.context(() => {
      const els = gsap.utils.toArray<HTMLElement>('.rx-d-reveal')
      els.forEach((el) => {
        gsap.from(el, {
          opacity: 0,
          y: 22,
          duration: 0.6,
          ease: HOUSE_EASE,
          scrollTrigger: { trigger: el, start: 'top 82%', toggleActions: 'play none none none' },
        })
      })
    }, section)

    return () => ctx.revert()
  }, [reduced])

  return (
    <section
      ref={sectionRef}
      className={'rx-decisions' + (reduced ? ' is-reduced' : '')}
      aria-label="Scene 02 — Only when needed"
      data-rx-decisions=""
      data-reduced={reduced ? 'true' : 'false'}
    >
      <div className="rx-decisions-inner">
        <div className="rx-eyebrow rx-d-eyebrow rx-d-reveal">
          <span className="rx-rule" />
          <span className="rx-label">Scene 02 · Only when needed</span>
        </div>

        <h2 className="rx-d-heading rx-d-reveal">
          It asks you what it can&rsquo;t know. It <span className="rx-d-accent">decides</span>{' '}
          everything else.
        </h2>

        {/* One composition: the single assisted decision (left) and the proof the
            rest was mechanical (right), joined — not divided — by the hinge line
            between them. Placed as a grid; each of the three parts stays its own
            reveal unit so cleanup/reduced-motion behaviour is unchanged. */}
        <div className="rx-d-stage">
          {/* ---------- LEFT — the decision (an AI proposal, not a finding) ---- */}
          <div className="rx-d-beat rx-d-decision rx-d-reveal">
            <div className="rx-d-kicker">
              <span className="rx-d-kicker-tag">Decision required</span>
              <span className="rx-d-kicker-note">
                {ev.fellBack
                  ? 'fell back to the deterministic default'
                  : 'the model proposed this — it did not fall back to the default'}
              </span>
            </div>

            {/* Evidence FIRST — what the model actually saw, then its reasoning. */}
            <dl className="rx-d-evidence">
              <div className="rx-d-ev-row">
                <dt className="rx-d-ev-label">Detected structure</dt>
                <dd className="rx-d-ev-value">
                  <span className="rx-d-navname tnum">{ev.navComponent}</span>
                  <span className="rx-d-links">
                    {navLinks.map((link) => (
                      <span key={link} className="rx-d-link tnum">
                        {link}
                      </span>
                    ))}
                  </span>
                </dd>
              </div>
              <div className="rx-d-ev-row">
                <dt className="rx-d-ev-label">Its reasoning</dt>
                <dd className="rx-d-ev-value rx-d-rationale">
                  {ev.rationale}
                  {/* A plain-language gloss — OURS, not the engine's verbatim text
                      (which stays exactly as exported above). Visually marked with
                      the "in plain terms" tag so a visitor knows it's a translation,
                      not what the engine said. Figure-free. */}
                  <span className="rx-d-gloss">
                    <span className="rx-d-gloss-tag">in plain terms</span>
                    tabs along the bottom for the main sections; a product&rsquo;s
                    detail page opens as its own screen you can swipe back from.
                  </span>
                </dd>
              </div>
            </dl>

            {/* The question the reasoning leads to. */}
            <p className="rx-d-question" data-testid="decision-question">
              {q.title}
            </p>

            {/* The options — the recommended one marked (read from the data). The
                relabel to "Decision required" must not erase where the pick came
                from: the recommendation genuinely came from the single assisted
                call, so it carries a quiet provenance marker tying it to that one
                call, plus our own plain-language reason (marked as OURS, the same
                way the gloss above is — never as if the engine said it). */}
            <ul className="rx-d-options">
              {options.map((o) => (
                <li
                  key={o.id}
                  className={'rx-d-option' + (o.isRecommended ? ' is-recommended' : '')}
                >
                  <div className="rx-d-option-head">
                    <span className="rx-d-option-label">{o.label}</span>
                    {o.isRecommended && <span className="rx-d-rec">Recommended</span>}
                  </div>
                  {o.isRecommended && (
                    <>
                      <span className="rx-d-provenance">
                        <span className="rx-d-provenance-dot" aria-hidden="true" />
                        from the one assisted call
                      </span>
                      {/* Our plain-language reason — not engine output. Marked as
                          ours with the same hairline treatment as the gloss. */}
                      <span className="rx-d-reason">
                        <span className="rx-d-reason-tag">our read</span>
                        Matches the detected structure.
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* ---------- HINGE — the line that joins the two sides -------------- */}
          {/* The whole-run cost as a statement, generously isolated. The figure
              beneath it is read from the data (never the worded "once" above). */}
          <div className="rx-d-join rx-d-reveal">
            <p className="rx-d-join-line">AI was needed once.</p>
            <p className="rx-d-join-cap tnum">
              {r.llmCalls} LLM call{r.llmCalls === 1 ? '' : 's'} · entire migration
            </p>
          </div>

          {/* ---------- RIGHT — the proof the rest was mechanical ------------- */}
          <div className="rx-d-beat rx-d-proof rx-d-reveal">
            {/* Headline row — three verdicts: tsc, Metro, and the validated figure. */}
            <div className="rx-d-proof-row">
              <div className="rx-d-metric rx-d-verified">
                <div className="rx-d-metric-value">{tscVerdict}</div>
                <div className="rx-d-metric-label">tsc typecheck</div>
              </div>
              <div className="rx-d-metric rx-d-verified">
                <div className="rx-d-metric-value">{metroVerdict}</div>
                <div className="rx-d-metric-label">Metro bundle</div>
              </div>
              <div className="rx-d-metric rx-d-verified rx-d-headline">
                <div className="rx-d-metric-value" data-testid="validated-coverage">
                  {r.validatedCoverage}%
                </div>
                <div className="rx-d-metric-label">
                  Validated coverage
                  <span className="rx-d-lens" data-testid="validated-lens">
                    working · compiles &amp; bundles
                  </span>
                </div>
              </div>
            </div>

            {/* Secondary treatment — the prediction and the stricter lens both kept
                visible (never merged into the headline, never behind a hover). */}
            <div className="rx-d-proof-secondary">
              <p className="rx-d-sub">
                predicted <span className="tnum" data-testid="predicted-coverage">{r.predictedCoverage}%</span>{' '}
                before migrating
              </p>
              <p className="rx-d-sub" data-testid="strict-coverage">
                strict · no leftover TODOs{' '}
                <span className="tnum">{r.validatedStrictCoverage}%</span>
              </p>
            </div>

            <ul className="rx-d-proof-lines">
              <li>Predicted before migrating. Verified after.</li>
              <li>Type-safe.</li>
              <li>Bundle-safe.</li>
              <li>Ready for review.</li>
            </ul>
          </div>
        </div>

        <p className="rx-d-attribution rx-d-reveal">
          Real figures from an actual Rejox pipeline run on the benchmark project
          (<span className="tnum">{data.project.name}</span>).
        </p>
      </div>
    </section>
  )
}
