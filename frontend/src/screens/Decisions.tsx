import { useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

import './Decisions.css'
import showcase from '../data/showcase.json' with { type: 'json' }
import type { ShowcaseData } from '../types/showcase.generated'

/**
 * Scene 02 — "Decisions".
 *
 * Answers the question Scene 01 raises: now that Rejox understands the project,
 * how does it DECIDE? Two beats stacked vertically, joined by a single isolated
 * line — the whole-run LLM call count:
 *
 *   Beat A  the one genuinely unknowable decision (the navigator shape), shown
 *           with its REAL provenance. This is an AI proposal, NOT an analyzer
 *           finding — there is no formal Evidence object. Its provenance is what
 *           the model actually saw (the navbar + its links) and its own reasoning
 *           (the spec rationale), presented in reading order evidence → question
 *           → options so a visitor sees WHY before WHAT.
 *   Beat B  the proof the rest was mechanical: tsc + Metro verdicts and the two
 *           coverage lenses — the working (compiles+bundles) headline AND the
 *           stricter residue-free figure, both genuinely visible, never merged
 *           with the analyzer's conservative pre-migration prediction.
 *
 * Every value comes from showcase.json via the generated type; no figure, name,
 * or question text is hard-coded. Unlike Scene 01 this section is NOT pinned —
 * it's short and dense, revealed on scroll (restrained fade-up, house language).
 * Its ScrollTriggers are created inside a gsap.context scoped to the section, so
 * cleanup kills only its own triggers and it coexists with the Scene 01 pin and
 * the CTA's ScrollReveal. Reduced motion shows everything at once.
 *
 * Desktop only.
 */

gsap.registerPlugin(ScrollTrigger)

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
          ease: 'power2.out',
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
      aria-label="Scene 02 — Decisions"
      data-rx-decisions=""
      data-reduced={reduced ? 'true' : 'false'}
    >
      <div className="rx-decisions-inner">
        <div className="rx-eyebrow rx-d-eyebrow rx-d-reveal">
          <span className="rx-rule" />
          <span className="rx-label">Scene 02 · Decisions</span>
        </div>

        <h2 className="rx-d-heading rx-d-reveal">
          It asks you what it can&rsquo;t know. It <span className="rx-d-accent">decides</span>{' '}
          everything else.
        </h2>

        {/* ---------- Beat A — the decision (an AI proposal, not a finding) ---- */}
        <div className="rx-d-beat rx-d-decision rx-d-reveal">
          <div className="rx-d-kicker">
            <span className="rx-d-kicker-tag">AI proposal</span>
            <span className="rx-d-kicker-note">
              {ev.fellBack
                ? 'fell back to the deterministic default'
                : 'the model proposed this — it did not fall back to the default'}
            </span>
          </div>

          {/* Evidence FIRST — what the model actually saw, then its reasoning. */}
          <dl className="rx-d-evidence">
            <div className="rx-d-ev-row">
              <dt className="rx-d-ev-label">What it saw</dt>
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
              <dd className="rx-d-ev-value rx-d-rationale">{ev.rationale}</dd>
            </div>
          </dl>

          {/* The question the reasoning leads to. */}
          <p className="rx-d-question" data-testid="decision-question">
            {q.title}
          </p>

          {/* The options — the recommended one marked (read from the data). */}
          <ul className="rx-d-options">
            {options.map((o) => (
              <li key={o.id} className={'rx-d-option' + (o.isRecommended ? ' is-recommended' : '')}>
                <span className="rx-d-option-label">{o.label}</span>
                {o.isRecommended && <span className="rx-d-rec">Recommended</span>}
              </li>
            ))}
          </ul>
        </div>

        {/* ---------- The joining line — the whole-run LLM count, isolated ---- */}
        <div className="rx-d-join rx-d-reveal">
          <p className="rx-d-join-line">
            <span className="rx-d-join-num tnum">{r.llmCalls}</span>
            <span className="rx-d-join-unit">LLM call{r.llmCalls === 1 ? '' : 's'}</span>
          </p>
          <p className="rx-d-join-cap">for the entire migration</p>
        </div>

        {/* ---------- Beat B — the proof the rest was mechanical -------------- */}
        <div className="rx-d-beat rx-d-proof rx-d-reveal">
          <div className="rx-d-proof-row">
            <div className="rx-d-metric rx-d-verified">
              <div className="rx-d-metric-value">{tscVerdict}</div>
              <div className="rx-d-metric-label">tsc typecheck</div>
            </div>
            <div className="rx-d-metric rx-d-verified">
              <div className="rx-d-metric-value">{metroVerdict}</div>
              <div className="rx-d-metric-label">Metro bundle</div>
            </div>
            <div className="rx-d-metric rx-d-predicted">
              <div className="rx-d-metric-value" data-testid="predicted-coverage">
                {r.predictedCoverage}%
              </div>
              <div className="rx-d-metric-label">Predicted coverage</div>
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
              <div className="rx-d-strict" data-testid="strict-coverage">
                strict · no leftover TODOs{' '}
                <span className="tnum">{r.validatedStrictCoverage}%</span>
              </div>
            </div>
          </div>
          <p className="rx-d-proof-note">
            Two lenses on the same validated build: working counts every file that
            compiles and bundles; strict counts only files with no leftover TODOs.
            Both are distinct from the analyzer&rsquo;s pre-migration prediction,
            which is deliberately conservative — it estimates before migrating;
            validation measures what the real tools confirmed after.
          </p>
        </div>

        <p className="rx-d-attribution rx-d-reveal">
          Real figures from an actual Rejox pipeline run on the benchmark project
          (<span className="tnum">{data.project.name}</span>).
        </p>
      </div>
    </section>
  )
}
