import { motion, useReducedMotion } from 'framer-motion'

import './Understanding.css'
import showcase from '../data/showcase.json' with { type: 'json' }
import type { ShowcaseData } from '../types/showcase.generated'

/**
 * Scene 01 — "Understanding".
 *
 * Three cards, read left to right, each a fact about the project before Rejox
 * touches it: the source files it read, the knowledge graph it built from
 * them, and the build order it derived from that graph. A plain in-flow
 * section — normal scroll, no pinning, no scroll-hijacking.
 *
 * Every figure comes from `showcase.json` via the generated type; nothing is
 * hard-coded. The understanding-phase LLM total is summed from the exporter's
 * real per-phase counts (the deterministic reading phases), not assumed.
 */

const data = showcase as ShowcaseData
const nodes = data.graph.nodes ?? []
const edges = data.graph.edges ?? []
const sourceFiles = data.project.sourceFiles ?? []

// --- Card 1: source files -----------------------------------------------
const nodeSourceFiles = new Set(nodes.map((n) => n.sourceFile))
const filesWithoutNode = sourceFiles.filter((f) => !nodeSourceFiles.has(f)).length

// --- Card 2: the knowledge graph ------------------------------------------
const edgeKindCount = new Set(edges.map((e) => e.kind)).size

// --- Card 3: build order ---------------------------------------------------
const waveSteps = data.waves ?? []
const waveCount = new Set(waveSteps.map((w) => w.wave)).size
const waveTargetIds = new Set(waveSteps.flatMap((w) => w.targets ?? []))
const nodesInWaves = nodes.filter((n) => waveTargetIds.has(n.id)).length
const nodesOutsideWaves = nodes.length - nodesInWaves

// The understanding-phase LLM total: summed from the exporter's MEASURED
// per-phase counts (the deterministic reading phases), never a constant.
const UNDERSTANDING_PHASES = new Set(['intelligence', 'analyze', 'plan'])
const understandingLlmCalls = (data.results.llmCallsByPhase ?? [])
  .filter((p) => UNDERSTANDING_PHASES.has(p.phase))
  .reduce((sum, p) => sum + p.calls, 0)

interface Card {
  id: string
  eyebrow: string
  value: number
  label: string
  detail: string
}

const CARDS: Card[] = [
  {
    id: 'files',
    eyebrow: '01 · Source files',
    value: sourceFiles.length,
    label: sourceFiles.length === 1 ? 'file read' : 'files read',
    detail: `${filesWithoutNode} are config or assets outside the dependency graph — they're read, not migrated.`,
  },
  {
    id: 'graph',
    eyebrow: '02 · Knowledge graph',
    value: nodes.length,
    label: nodes.length === 1 ? 'node' : 'nodes',
    detail: `${edges.length} edges across ${edgeKindCount} kinds — every component, hook, and store, connected.`,
  },
  {
    id: 'waves',
    eyebrow: '03 · Build order',
    value: waveCount,
    label: waveCount === 1 ? 'build wave' : 'build waves',
    detail: `${waveSteps.length} plan steps · ${nodesInWaves} nodes are build units, ${nodesOutsideWaves} are import structure.`,
  },
]

export default function Understanding() {
  const reduceMotion = useReducedMotion() === true

  return (
    <section
      className="rx-understanding"
      aria-label="Scene 01 — Understanding"
      data-rx-understanding=""
    >
      <div className="rx-understanding-inner">
        <motion.div
          className="rx-eyebrow rx-u-eyebrow"
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="rx-rule" />
          <span className="rx-label">Scene 01 · Understanding</span>
        </motion.div>

        <motion.h2
          className="rx-u-heading"
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
        >
          Rejox <span className="rx-u-accent">reads</span> your project before it
          touches it.
        </motion.h2>

        <div className="rx-u-cards">
          {CARDS.map((c, i) => (
            <motion.div
              key={c.id}
              className="rx-u-card"
              initial={reduceMotion ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{
                duration: 0.5,
                ease: [0.22, 1, 0.36, 1],
                delay: reduceMotion ? 0 : 0.1 + i * 0.08,
              }}
            >
              <div className="rx-u-card-eyebrow">{c.eyebrow}</div>
              <div className="rx-u-card-value tnum">{c.value}</div>
              <div className="rx-u-card-label">{c.label}</div>
              <p className="rx-u-card-detail">{c.detail}</p>
            </motion.div>
          ))}
        </div>

        {/* Always visible — the understanding phase's real LLM count, with its
            scope made explicit: this figure is the reading phase only; the
            whole run's count (from the same data) sits beside it, so 0 is
            never read as "the whole migration used none". */}
        <motion.div
          className="rx-u-llm"
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: reduceMotion ? 0 : 0.34 }}
        >
          <div className="rx-u-llm-value tnum">{understandingLlmCalls}</div>
          <div className="rx-u-llm-label">LLM calls · understanding</div>
          <div className="rx-u-llm-sub">
            whole run · <span className="tnum">{data.results.llmCalls}</span>
          </div>
        </motion.div>

        <p className="rx-u-attribution">
          Real figures from an actual Rejox pipeline run on the benchmark project
          (<span className="tnum">{data.project.name}</span>).
        </p>
      </div>
    </section>
  )
}
