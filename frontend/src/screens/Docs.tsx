import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import type { Variants } from 'framer-motion'
import { Link } from 'react-router-dom'

import './Docs.css'
import { SiteHeader } from '../components/SiteHeader'

/* ============================================================================
 * /docs — a classic two-column docs page: a sticky left sidebar of sections and
 * a readable content column. Reuses the shared <SiteHeader/> chrome and the
 * /architecture page shell (same tokens, type scale, and one-shot entry fade).
 *
 * Only Getting Started and Limitations are written this session. The other five
 * sections are real anchors on THIS page (so the sidebar links resolve) but
 * render no body yet — no separate routes, no "coming soon" filler.
 * ==========================================================================*/

type Section = { id: string; label: string }
const SECTIONS: Section[] = [
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'uploading-projects', label: 'Uploading Projects' },
  { id: 'reading-reports', label: 'Reading Reports' },
  { id: 'cli', label: 'CLI' },
  { id: 'rules', label: 'Rules' },
  { id: 'limitations', label: 'Limitations' },
  { id: 'faq', label: 'FAQ' },
]

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.04 } },
}
const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
}

/** Scroll-spy: highlight the sidebar link for the current section. The active
 * section is the last one whose heading has scrolled above a line ~40% down the
 * viewport (the canonical docs behaviour), recomputed on scroll and throttled
 * with rAF. */
function useActiveSection(): string {
  const [activeId, setActiveId] = useState(SECTIONS[0].id)
  useEffect(() => {
    const ids = SECTIONS.map((s) => s.id)
    let ticking = false

    const update = () => {
      ticking = false
      // Activation line ~40% down the viewport: a section becomes current once
      // its heading crosses it. Viewport-relative (not a small fixed offset) so
      // the last, short section can still reach it.
      const line = window.innerHeight * 0.4
      let current = ids[0]
      for (const id of ids) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= line) current = id
      }
      // Safety net: at the very bottom the last section is current even if a
      // short trailing section never scrolled up to the line.
      const doc = document.documentElement
      if (window.scrollY + window.innerHeight >= doc.scrollHeight - 2) {
        current = ids[ids.length - 1]
      }
      setActiveId(current)
    }
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return activeId
}

export function Docs() {
  const reduce = useReducedMotion()
  const activeId = useActiveSection()
  const contentMotion = reduce
    ? {}
    : { variants: container, initial: 'hidden' as const, animate: 'show' as const }
  const block = reduce ? {} : { variants: item }

  return (
    <div className="rx-docs">
      <SiteHeader />

      <div className="rx-docs-main">
        {/* ---- sticky sidebar: all seven sections as anchored links ---- */}
        <motion.aside
          className="rx-docs-sidebar"
          {...(reduce ? {} : { variants: item, initial: 'hidden' as const, animate: 'show' as const })}
        >
          <p className="rx-docs-eyebrow">Documentation</p>
          <nav className="rx-docs-nav" aria-label="Docs sections">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={'#' + s.id}
                className={'rx-docs-navlink' + (activeId === s.id ? ' is-active' : '')}
                aria-current={activeId === s.id ? 'true' : undefined}
              >
                {s.label}
              </a>
            ))}
          </nav>
        </motion.aside>

        {/* ---- content column ---- */}
        <motion.div className="rx-docs-content" {...contentMotion}>
          {/* Getting Started — the real, current local-run + first-migration flow */}
          <motion.section id="getting-started" className="rx-docs-section rx-docs-section--first" {...block}>
            <p className="rx-docs-kicker">Getting Started</p>
            <h1 className="rx-docs-title">Run Rejox locally</h1>
            <p className="rx-docs-body">
              Rejox runs as two local services — a FastAPI backend on{' '}
              <code>:8000</code> and a Vite frontend on <code>:5173</code> —
              driven by a single script.
            </p>

            <h2 className="rx-docs-h3">Start both services</h2>
            <p className="rx-docs-body">
              From the repo root, one command brings up the backend and the
              frontend together and tears both down on <code>Ctrl+C</code>:
            </p>
            <pre className="rx-docs-cmd">
              <code>./dev.sh</code>
            </pre>
            <p className="rx-docs-body">
              The Upload → Analyze → Report path is fully deterministic and needs
              no API key. First run? Do the one-time install from the README — a
              Python venv for the backend, <code>npm install</code> for the
              frontend — then <code>./dev.sh</code>.
            </p>

            <h2 className="rx-docs-h3">Your first migration</h2>
            <p className="rx-docs-body">
              With both services up, open{' '}
              <code>http://localhost:5173</code> and work through the pipeline:
            </p>
            <ol className="rx-docs-steps">
              <li>
                <strong>Upload a project.</strong> Drop in a React codebase as a
                ZIP, or paste a public GitHub URL.
              </li>
              <li>
                <strong>Read the report.</strong> Coverage, Confidence, and Risk,
                with the findings behind each score.
              </li>
              <li>
                <strong>Answer the Ask questions, if any.</strong> Rejox surfaces
                the decisions it genuinely can't make for you — ambiguous or
                unsupported bits.
              </li>
              <li>
                <strong>Run the migration.</strong> Deterministic codemods do the
                bulk of the work; AI is the scalpel for the residue.
              </li>
              <li>
                <strong>Download the result.</strong> A working React Native
                project plus the transparent report.
              </li>
            </ol>
          </motion.section>

          {/* Uploading Projects — accepted inputs, the real ingest guards, and
              the honest rejection path */}
          <motion.section id="uploading-projects" className="rx-docs-section" {...block}>
            <p className="rx-docs-kicker">Uploading Projects</p>
            <h2 className="rx-docs-h2">What Rejox accepts</h2>
            <p className="rx-docs-body">
              Two ways in: a zipped React project (a <code>.zip</code> archive)
              or a public GitHub URL (<code>https://github.com/owner/repo</code>),
              which Rejox clones for you.
            </p>

            <h2 className="rx-docs-h3">Size &amp; safety limits</h2>
            <p className="rx-docs-body">
              An upload is untrusted, so extraction is the trust boundary. The
              same guards run in the browser and the backend:
            </p>
            <ul className="rx-docs-list">
              <li>
                <strong>100 MB</strong> maximum compressed archive.
              </li>
              <li>
                <strong>500 MB</strong> maximum expanded size — a running byte
                counter aborts zip bombs mid-extraction.
              </li>
              <li>
                <strong>20,000</strong> maximum files.
              </li>
              <li>
                Archive entries or symlinks that resolve outside the extract root
                are rejected outright (no path traversal).
              </li>
            </ul>

            <h2 className="rx-docs-h3">More than one React root</h2>
            <p className="rx-docs-body">
              Rejox scans every <code>package.json</code> that declares React and
              lists each directory as a candidate root, defaulting to the
              shallowest — the natural wrapping project. In a monorepo with
              several React apps, you choose which root to migrate; it never
              guesses silently.
            </p>

            <h2 className="rx-docs-h3">When something's rejected</h2>
            <p className="rx-docs-body">
              Rejections are explicit, not partial runs. A file that isn't a{' '}
              <code>.zip</code>, an over-limit archive, a URL that isn't a public
              GitHub repo, or an upload where no <code>package.json</code>{' '}
              declares React (<em>“No React project found”</em>) each fails up
              front with a message that says exactly what was wrong.
            </p>
          </motion.section>

          {/* Reading Reports — the most important section: Coverage vs Confidence,
              then working vs strict coverage, then the breakdown + domain risk */}
          <motion.section id="reading-reports" className="rx-docs-section" {...block}>
            <p className="rx-docs-kicker">Reading Reports</p>
            <h2 className="rx-docs-h2">Two numbers, never merged</h2>
            <p className="rx-docs-body">
              The report leads with <strong>Coverage</strong> and{' '}
              <strong>Confidence</strong> — two scores that used to be one. They
              were split on purpose, because a single blended “migration score”
              hid which half was weak.
            </p>
            <ul className="rx-docs-list">
              <li>
                <strong>Coverage (0–100)</strong> — how much of the project{' '}
                <em>can be</em> migrated.
              </li>
              <li>
                <strong>Confidence (0–100)</strong> — how sure Rejox is that what
                it <em>did</em> migrate is correct.
              </li>
            </ul>
            <p className="rx-docs-body">
              They're independent axes. A project can score high Coverage with low
              Confidence (lots migrated, but with warnings) or low Coverage with
              high Confidence (a small slice migrated, but cleanly). Merging them
              would erase that distinction. The dividing rule: code that couldn't
              be migrated at all counts against <em>Coverage</em>, never against
              Confidence — Confidence only judges the units actually migrated.
            </p>

            <h2 className="rx-docs-h3">Working vs strict coverage</h2>
            <p className="rx-docs-body">
              After a migration is validated against the real toolchain (
              <code>tsc</code> + Metro), Coverage is reported two ways — the same
              pair Scene 02 on the home page shows side by side:
            </p>
            <ul className="rx-docs-list">
              <li>
                <strong>Working coverage</strong> — the share of generated files
                that <em>compile and bundle</em>. It runs.
              </li>
              <li>
                <strong>Strict coverage</strong> — the share that is also free of
                leftover <code>REJOX-TODO</code> markers — nothing left for a
                human to finish.
              </li>
            </ul>
            <p className="rx-docs-body">
              Working is always ≥ strict: a file can compile and bundle while
              still carrying a TODO for a pattern Rejox flagged rather than
              guessed. So if the home page left you wondering why{' '}
              <em>“working · compiles &amp; bundles”</em> and{' '}
              <em>“strict · no leftover TODOs”</em> were different percentages —
              that gap is exactly the honestly-flagged residue.
            </p>

            <h2 className="rx-docs-h3">Behind the scores</h2>
            <p className="rx-docs-body">
              Coverage isn't a vibe. It's a sum of signed{' '}
              <strong>ScoreContribution</strong> rows — components, libraries,
              styling, routing, API — whose deltas add up to exactly the number,
              so every point traces back to a specific finding. Alongside them,{' '}
              <strong>Domain Risk</strong> classifies functional areas (auth,
              data, payments, and the like); the project's overall Risk is the
              worst domain detected, and “low” when none is.
            </p>
          </motion.section>

          {/* CLI — short: the two real commands */}
          <motion.section id="cli" className="rx-docs-section" {...block}>
            <p className="rx-docs-kicker">CLI</p>
            <h2 className="rx-docs-h2">Run it from the terminal</h2>
            <p className="rx-docs-body">
              The same pipeline runs headless. Point <code>rejox migrate</code> at
              a project and it goes end to end — parse, analyze, plan, migrate,
              validate:
            </p>
            <pre className="rx-docs-cmd">
              <code>rejox migrate &lt;project-path&gt; [--out &lt;dir&gt;] [--yes] [--no-validate]</code>
            </pre>
            <p className="rx-docs-body">
              For example, on the bundled sample app, accepting every recommended
              answer non-interactively:
            </p>
            <pre className="rx-docs-cmd">
              <code>rejox migrate ../test-projects/sample-app --yes</code>
            </pre>
            <p className="rx-docs-body">
              <code>--out</code> chooses where to write the React Native project,
              and <code>--no-validate</code> skips the <code>tsc</code> + Metro
              stage for a faster dry run. There's also{' '}
              <code>rejox export-showcase</code>, which runs the full pipeline on
              the sample app and freezes the result into the{' '}
              <code>showcase.json</code> this site reads.
            </p>
          </motion.section>

          {/* Rules — the ladder in plain terms + pointer to the Architecture table */}
          <motion.section id="rules" className="rx-docs-section" {...block}>
            <p className="rx-docs-kicker">Rules</p>
            <h2 className="rx-docs-h2">How a pattern gets resolved</h2>
            <p className="rx-docs-body">
              Every pattern descends a three-rung ladder and stops at the first
              rung that resolves it. The whole design is to reach for the LLM
              last, and rarely:
            </p>
            <ol className="rx-docs-steps">
              <li>
                <strong>Static map.</strong> A direct lookup — this element, prop,
                or event maps (or drops) by rule. No reasoning.
              </li>
              <li>
                <strong>Pattern resolvers.</strong> A structural rewrite — e.g. a{' '}
                <code>:hover</code> block becomes a pressed-state variant. Still
                fully deterministic.
              </li>
              <li>
                <strong>LLM, as a last resort.</strong> Only a genuinely
                unparseable value of a known target, and only if a provider is
                configured — otherwise it's dropped with a warning. Nothing is
                ever guessed.
              </li>
            </ol>
            <p className="rx-docs-note">
              This page keeps it conceptual on purpose.{' '}
              <Link className="rx-docs-inlink" to="/architecture">
                See Architecture
              </Link>{' '}
              for the full conversion table — every React pattern, its React
              Native target, and the method used.
            </p>
          </motion.section>

          {/* Limitations — a matter-of-fact known-scope list */}
          <motion.section id="limitations" className="rx-docs-section" {...block}>
            <p className="rx-docs-kicker">Limitations</p>
            <h2 className="rx-docs-h2">What Rejox doesn't handle yet</h2>
            <p className="rx-docs-body">
              Rejox has a deliberately bounded scope. These are the patterns it
              doesn't resolve today — known edges, not surprises. Hit one and it's
              flagged in the report, never silently mis-migrated.
            </p>
            <ul className="rx-docs-list">
              <li>
                <strong><code>createBrowserRouter</code> object routes.</strong>{' '}
                The route table is read from <code>&lt;Route&gt;</code> /{' '}
                <code>&lt;Link&gt;</code> JSX, not from a data-router config
                object.
              </li>
              <li>
                <strong>Tailwind v3 config files.</strong> Utility classes map,
                but a <code>tailwind.config</code> — theme extensions, custom
                tokens — isn't read yet.
              </li>
              <li>
                <strong>Barrel exports.</strong> Re-export hubs (an{' '}
                <code>index.ts</code> that <code>export *</code> from many
                modules) aren't followed through to their origins.
              </li>
              <li>
                <strong>Runtime <code>clsx</code> / <code>cva</code> classes.</strong>{' '}
                Classes assembled at runtime can't be resolved statically; only
                literal <code>className</code> strings are mapped.
              </li>
              <li>
                <strong>Fully-dynamic URLs.</strong> Template or computed paths
                that can't be pinned to a route-table entry.
              </li>
            </ul>
          </motion.section>

          {/* FAQ — real questions from this project's own design decisions */}
          <motion.section id="faq" className="rx-docs-section" {...block}>
            <p className="rx-docs-kicker">FAQ</p>
            <h2 className="rx-docs-h2">Questions that keep coming up</h2>

            <h3 className="rx-docs-h3">Why only one LLM call?</h3>
            <p className="rx-docs-body">
              Because rules resolve almost everything. The single call is the one
              genuine design judgment — the navigator shape (stack vs. tab, and
              how screens nest); all the mechanical work is deterministic AST
              transformation. Rejox even runs with AI switched off, defaulting
              that one decision.
            </p>

            <h3 className="rx-docs-h3">What happens if migration fails partway?</h3>
            <p className="rx-docs-body">
              The Review stage runs the real toolchain (<code>tsc</code> + Metro);
              errors loop back to the AI Resolution Engine for a bounded number of
              repair rounds. Anything still unresolved is left as a flagged{' '}
              <code>REJOX-TODO</code> and reported — you get a partial, honest
              result, never a silent failure.
            </p>

            <h3 className="rx-docs-h3">Does Rejox modify my original project?</h3>
            <p className="rx-docs-body">
              No. It reads your code and writes a new React Native project to a
              separate output directory (<code>--out</code>, or a temp dir); the
              web flow extracts your upload into an isolated run workspace. Your
              source is never edited in place.
            </p>

            <h3 className="rx-docs-h3">Do I need a Gemini API key?</h3>
            <p className="rx-docs-body">
              Not for Upload → Analyze → Report — that path is fully deterministic
              and makes zero LLM calls. The one migrate-time call uses a real key
              if <code>GEMINI_API_KEY</code> is set, an offline provider if{' '}
              <code>REJOX_AI_PROVIDER=fake</code>, or is skipped entirely (the
              navigator falls back to a default) if neither.
            </p>
          </motion.section>
        </motion.div>
      </div>
    </div>
  )
}
