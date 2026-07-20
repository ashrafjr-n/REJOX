import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import type { Variants } from 'framer-motion'

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
// The sections that have a body this session; the rest are empty anchor stubs.
const WRITTEN = new Set(['getting-started', 'limitations'])

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.04 } },
}
const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
}

/** Scroll-spy: highlight the sidebar link for the current section.
 * Only the written sections drive this — the empty stubs are 0-height and
 * clustered, so they'd make a bodyless anchor win over the real section beside
 * it. The active section is the last written one whose top has scrolled above a
 * line just below the fixed header (the canonical docs behaviour), recomputed on
 * scroll and throttled with rAF. */
function useActiveSection(): string {
  const [activeId, setActiveId] = useState(SECTIONS[0].id)
  useEffect(() => {
    const ids = SECTIONS.filter((s) => WRITTEN.has(s.id)).map((s) => s.id)
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

          {/* Empty anchor stubs — the five sections not written yet. They give
              the sidebar links a real target on this page without rendering a
              body or claiming "coming soon". */}
          {SECTIONS.filter((s) => !WRITTEN.has(s.id) && s.id !== 'faq').map((s) => (
            <div key={s.id} id={s.id} className="rx-docs-stub" aria-hidden="true" />
          ))}

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

          {/* FAQ anchor stub, kept last to match the sidebar order. */}
          <div id="faq" className="rx-docs-stub" aria-hidden="true" />
        </motion.div>
      </div>
    </div>
  )
}
