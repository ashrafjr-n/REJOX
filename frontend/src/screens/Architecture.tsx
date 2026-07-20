import { motion, useReducedMotion } from 'framer-motion'
import type { Variants } from 'framer-motion'

import './Architecture.css'
import { SiteHeader } from '../components/SiteHeader'
import showcase from '../data/showcase.json' with { type: 'json' }
import type { ShowcaseData } from '../types/showcase.generated'

/* ============================================================================
 * /architecture — a static, single-column explainer of how Rejox is built.
 *
 * Reuses the shared <SiteHeader/> chrome and the home page's tokens/fonts; the
 * only motion is a one-shot fade-in on entry (disabled under reduced motion).
 * Every figure — graph size, per-phase and total LLM calls, the sample project
 * name — is read from the committed showcase.json via its generated type, never
 * hardcoded. The conversion-rules table below is the one deliberate exception
 * (its rows are hand-authored for now; a generator is future work).
 * ==========================================================================*/

const data = showcase as ShowcaseData

// --- figures pulled from showcase.json ---------------------------------------
const nodes = data.graph.nodes ?? []
const edges = data.graph.edges ?? []
const nodeCount = nodes.length
const edgeCount = edges.length

/** Count occurrences of a kind, returned as [kind, n] pairs, largest first. */
function tally(kinds: string[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}
const nodeKinds = tally(nodes.map((n) => n.kind))
const edgeKinds = tally(edges.map((e) => e.kind))

const totalLlmCalls = data.results.llmCalls
const projectName = data.project.name
// Measured LLM calls per phase (a real delta of the run's call counter — the
// zeros are observed, not assumed). Phases absent from the export have no
// measured count; those stages carry no LLM call by construction.
const phaseCalls = new Map(
  (data.results.llmCallsByPhase ?? []).map((p) => [p.phase, p.calls]),
)

// --- the 8 pipeline stages ---------------------------------------------------
// `phase` links a stage to its measured showcase.json phase where one exists;
// Upload / Ask / Download have no LLM phase (structural — zero by construction).
type Stage = { n: number; name: string; phase: string | null; takes: string; gives: string }
const STAGES: Stage[] = [
  { n: 1, name: 'Upload', phase: null, takes: 'a React project (zip or repo)', gives: 'a normalized source tree on disk' },
  { n: 2, name: 'Intelligence', phase: 'intelligence', takes: 'the source tree', gives: 'a deterministic Knowledge Graph (nodes + edges)' },
  { n: 3, name: 'Report', phase: 'analyze', takes: 'the Knowledge Graph', gives: 'findings + Coverage / Confidence / Risk scores' },
  { n: 4, name: 'Plan', phase: 'plan', takes: 'the analysis', gives: 'an ordered, actionable migration plan' },
  { n: 5, name: 'Ask', phase: null, takes: "the plan's ambiguities", gives: 'human decisions on the unsupported / ambiguous bits' },
  { n: 6, name: 'Migrate', phase: 'migrate', takes: 'the plan + source', gives: 'transformed RN files — deterministic codemods first, AI only for the residue' },
  { n: 7, name: 'Review', phase: 'repair', takes: 'the migrated output', gives: 'validation (tsc + Metro) + self-review; failures loop back' },
  { n: 8, name: 'Download', phase: null, takes: 'the validated project', gives: 'a packaged RN project + the final report' },
]
function stageCalls(stage: Stage): number {
  return stage.phase ? phaseCalls.get(stage.phase) ?? 0 : 0
}

// --- conversion rules (hand-authored; a generator is future work) ------------
type Method = 'Deterministic' | 'Rule' | 'Assisted' | 'Manual review'
type ConversionRow = { react: string; rn: string; method: Method }
const CONVERSION_ROWS: ConversionRow[] = [
  { react: '<div> / <section> / <nav>', rn: '<View>', method: 'Deterministic' },
  { react: '<span> / <p> / <h1>–<h6>', rn: '<Text>', method: 'Deterministic' },
  { react: '<img src>', rn: '<Image source={{ uri }}>', method: 'Deterministic' },
  { react: '<button>, onClick', rn: '<Pressable>, onPress', method: 'Deterministic' },
  { react: '<Link to> / useParams (react-router)', rn: 'navigation.navigate / useRoute', method: 'Rule' },
  { react: 'className / Tailwind utilities', rn: 'NativeWind className', method: 'Rule' },
  { react: 'CSS Module (*.module.css)', rn: 'StyleSheet.create', method: 'Rule' },
  { react: 'localStorage', rn: 'AsyncStorage (awaited)', method: 'Assisted' },
  { react: 'bg-gradient / from- / to-', rn: 'expo-linear-gradient', method: 'Assisted' },
  { react: 'CSS grid / media query', rn: 'flexbox reflow', method: 'Manual review' },
  { react: ':hover / hover: / group-hover:', rn: '— (no hover on touch)', method: 'Manual review' },
  { react: '<table> / <canvas> / <iframe>', rn: '— (no RN equivalent)', method: 'Manual review' },
]

const SUPPORTED = [
  'Host elements → RN primitives (div/span/img/button/input → View/Text/Image/Pressable/TextInput)',
  'Event renames — onClick → onPress, onChange → onChangeText',
  'react-router-dom → React Navigation (Link & useParams resolved by the route table)',
  'Flexbox layout — RN is flexbox by default',
  'Tailwind / NativeWind — most utilities map directly',
  'CSS Modules → StyleSheet, by rule',
]
const UNSUPPORTED = [
  'CSS grid & media queries — no RN equivalent',
  ':hover / hover: / group-hover: — no hover on a touch surface',
  'Mouse / keyboard / form-submit events — onMouseEnter, onKeyDown, onSubmit',
  'Web-only elements — <table>, <canvas>, <iframe>',
  'Redux / Three.js / Next.js / Electron — unsupported in the MVP',
]

// --- entry motion: a single one-shot fade, disabled under reduced motion -----
const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.04 } },
}
const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
}

export function Architecture() {
  const reduce = useReducedMotion()
  // Under reduced motion, skip the variants entirely — content renders static.
  const motionProps = reduce
    ? {}
    : { variants: container, initial: 'hidden' as const, animate: 'show' as const }
  const block = reduce ? {} : { variants: item }

  return (
    <div className="rx-arch">
      <SiteHeader />

      <motion.main className="rx-arch-main" {...motionProps}>
        {/* 1 — core principle + the problem / the answer */}
        <motion.header className="rx-arch-lede" {...block}>
          <p className="rx-arch-kicker">The core principle</p>
          <h1 className="rx-arch-title">
            Resolve by rules whatever rules can resolve. Invoke AI only where
            genuine reasoning is required.
          </h1>
          <p className="rx-arch-body">
            An LLM handed a whole project will confidently invent imports,
            reshape files it was never asked to touch, and paper over the parts
            it doesn't understand. Ingesting everything doesn't make it more
            careful — it makes it hallucinate at scale.
          </p>
          <p className="rx-arch-body">
            So Rejox inverts the default. Every pattern is first resolved
            deterministically — by AST transform, by a lookup, by a rule. The AI
            layer is a scalpel for the residue that rules genuinely can't reach,
            never the path of first resort.
          </p>
        </motion.header>

        {/* 2 — the process split: Python orchestrates, Node parses/transforms */}
        <motion.section className="rx-arch-section" {...block}>
          <h2 className="rx-arch-h2">Two runtimes, one contract</h2>
          <p className="rx-arch-body">
            Python owns the pipeline; the JavaScript/TypeScript is parsed and
            rewritten by Node workers built on <code>ts-morph</code>. Typed
            pydantic models are the only thing that crosses between them.
          </p>
          <div className="rx-arch-diagram" role="img" aria-label="Python orchestrates two ts-morph Node workers via pydantic contracts">
            <div className="rx-arch-node rx-arch-node--py">
              <span className="rx-arch-node-t">Python</span>
              <span className="rx-arch-node-s">orchestrator — planner, analyzer, validator</span>
            </div>
            <div className="rx-arch-wire">
              <span className="rx-arch-wire-l">pydantic contracts</span>
            </div>
            <div className="rx-arch-workers">
              <div className="rx-arch-node rx-arch-node--node">
                <span className="rx-arch-node-t">parser-worker</span>
                <span className="rx-arch-node-s">ts-morph → Knowledge Graph</span>
              </div>
              <div className="rx-arch-node rx-arch-node--node">
                <span className="rx-arch-node-t">codemod-worker</span>
                <span className="rx-arch-node-s">ts-morph → transformed source</span>
              </div>
            </div>
          </div>
          <p className="rx-arch-note">Python never parses JS. Not once.</p>
        </motion.section>

        {/* 3 — the eight pipeline stages, each with its LLM call count */}
        <motion.section className="rx-arch-section" {...block}>
          <h2 className="rx-arch-h2">The pipeline, stage by stage</h2>
          <p className="rx-arch-body">
            Eight stages, in order. The right column is the measured LLM call
            count for the <code>{projectName}</code> run — almost all zero.
          </p>
          <ol className="rx-arch-stages">
            {STAGES.map((s) => {
              const calls = stageCalls(s)
              return (
                <li key={s.n} className="rx-arch-stage">
                  <div className="rx-arch-stage-head">
                    <span className="rx-arch-stage-name">
                      <span className="rx-arch-stage-n">{s.n}</span>
                      {s.name}
                    </span>
                    <span
                      className={
                        'rx-arch-stage-calls' + (calls === 0 ? ' is-zero' : '')
                      }
                    >
                      {calls} LLM {calls === 1 ? 'call' : 'calls'}
                    </span>
                  </div>
                  <p className="rx-arch-stage-body">
                    Takes {s.takes}; produces {s.gives}.
                  </p>
                </li>
              )
            })}
          </ol>
        </motion.section>

        {/* 4 — knowledge graph size, from showcase.json */}
        <motion.section className="rx-arch-section" {...block}>
          <h2 className="rx-arch-h2">The Knowledge Graph</h2>
          <p className="rx-arch-body">
            The Project Intelligence Engine turns <code>{projectName}</code> into
            a graph before anything is migrated — every component, hook, store,
            and the edges that connect them.
          </p>
          <div className="rx-arch-stats">
            <div className="rx-arch-stat">
              <span className="rx-arch-stat-n">{nodeCount}</span>
              <span className="rx-arch-stat-l">nodes</span>
            </div>
            <div className="rx-arch-stat">
              <span className="rx-arch-stat-n">{edgeCount}</span>
              <span className="rx-arch-stat-l">edges</span>
            </div>
          </div>
          <div className="rx-arch-kinds">
            <div>
              <p className="rx-arch-kinds-t">Nodes by kind</p>
              <ul className="rx-arch-taglist">
                {nodeKinds.map(([k, n]) => (
                  <li key={k}>
                    {k} <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="rx-arch-kinds-t">Edges by kind</p>
              <ul className="rx-arch-taglist">
                {edgeKinds.map(([k, n]) => (
                  <li key={k}>
                    {k} <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </motion.section>

        {/* 5 — the three-tier resolution ladder */}
        <motion.section className="rx-arch-section" {...block}>
          <h2 className="rx-arch-h2">The resolution ladder</h2>
          <p className="rx-arch-body">
            Every piece of residue descends three rungs, and stops at the first
            that resolves it. On real input the bottom rung is rarely reached.
          </p>
          <ol className="rx-arch-ladder">
            <li>
              <span className="rx-arch-rung">1 · Static map</span>
              <p>A direct lookup — this property, element, or event maps (or drops) by rule. No reasoning.</p>
            </li>
            <li>
              <span className="rx-arch-rung">2 · Pattern resolvers</span>
              <p>A structural rewrite — e.g. a <code>:hover</code> block becomes a <code>Pressed</code> style variant. Still deterministic.</p>
            </li>
            <li>
              <span className="rx-arch-rung">3 · LLM</span>
              <p>Only a genuinely unparseable value of a known target, and only if a provider is configured — otherwise it's dropped with a warning. Nothing is ever guessed.</p>
            </li>
          </ol>
          <p className="rx-arch-note">
            The AI never sees a whole file. Each request is a scalpel-sized slice:
            snippet + context is capped at a line budget, and an over-budget
            request raises <code>SnippetBudgetError</code> before it can reach a
            model.
          </p>
        </motion.section>

        {/* 6 — the conversion-rules table (hand-authored rows) */}
        <motion.section className="rx-arch-section" {...block}>
          <h2 className="rx-arch-h2">Conversion rules</h2>
          <p className="rx-arch-body">
            How React patterns map to React Native, and by what method —
            deterministic AST transform, a structured rule, AI-assisted, or
            flagged for manual review.
          </p>
          <div className="rx-arch-tablewrap">
            <table className="rx-arch-table">
              <thead>
                <tr>
                  <th>React</th>
                  <th>React Native</th>
                  <th>Method</th>
                </tr>
              </thead>
              <tbody>
                {CONVERSION_ROWS.map((r) => (
                  <tr key={r.react}>
                    <td><code>{r.react}</code></td>
                    <td><code>{r.rn}</code></td>
                    <td>
                      <span className={'rx-arch-method m-' + r.method.split(' ')[0].toLowerCase()}>
                        {r.method}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.section>

        {/* 7 — supported / unsupported, side by side */}
        <motion.section className="rx-arch-section" {...block}>
          <h2 className="rx-arch-h2">What migrates, what doesn't</h2>
          <div className="rx-arch-cols">
            <div className="rx-arch-col">
              <p className="rx-arch-col-t rx-arch-col-t--ok">Supported</p>
              <ul className="rx-arch-list">
                {SUPPORTED.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
            <div className="rx-arch-col">
              <p className="rx-arch-col-t rx-arch-col-t--no">Unsupported</p>
              <ul className="rx-arch-list">
                {UNSUPPORTED.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
        </motion.section>

        {/* 8 — closing: why only one LLM call, with the real number */}
        <motion.section className="rx-arch-closing" {...block}>
          <h2 className="rx-arch-h2">Why only one LLM call</h2>
          <p className="rx-arch-body">
            The whole point. Migrating <code>{projectName}</code> took exactly{' '}
            <strong>
              {totalLlmCalls} LLM {totalLlmCalls === 1 ? 'call' : 'calls'}
            </strong>{' '}
            — every other transformation was resolved by rule. AI wasn't the
            engine; it was the scalpel, used once, exactly where reasoning was
            genuinely required.
          </p>
        </motion.section>
      </motion.main>
    </div>
  )
}
