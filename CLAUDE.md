# Rejox AI

> **Rejox AI is an AI-assisted migration system that combines deterministic code transformation with targeted AI reasoning to safely migrate React applications into React Native.**
>
> **Core principle: resolve by rules whatever rules can resolve. Invoke AI only where genuine reasoning is required.**
> Never describe Rejox as a "code converter". Every new capability must first be attempted deterministically; the AI layer is a scalpel for the residue, never the default path.

Users upload a React codebase; Rejox builds a knowledge graph of it, proposes a
migration plan, asks clarifying questions, performs the migration with
deterministic AST transforms (plus targeted AI reasoning for the residue),
validates the output, and hands back a working React Native project and a
transparent report.

Product and engineering docs live in `docs/` — read those first.

## The 8-stage pipeline

Every migration flows through these stages, in order:

1. **Upload**       — user submits a React project (zip / repo).
2. **Intelligence** — the Project Intelligence Engine builds a deterministic knowledge graph.
3. **Report**       — summarize what the project uses; Coverage / Confidence / Risk.
4. **Plan**         — produce a concrete, ordered migration plan.
5. **Ask**          — surface decisions that need human input (ambiguities, unsupported bits).
6. **Migrate**      — the Migration Engine: Deterministic Transformer first, AI Resolution Engine only for the residue.
7. **Review**       — validate the output (tsc + Metro) and self-review changes.
8. **Download**     — package the migrated React Native project + final report.

## Engine architecture

The pipeline is driven by a set of focused engines:

- **Planner**                     — orchestrates the pipeline and sequences the stages.
- **Project Intelligence Engine** — parser + dependency scanner + AST builder + metadata
  extractor + graph builder; emits the Knowledge Graph (Node worker: `parser-worker`).
- **Analyzer**                    — walks the knowledge graph: findings, domain risk
  assessment, Coverage / Confidence / Risk scoring.
- **Library Detector**            — identifies dependencies and maps them to RN equivalents.
- **Migration Planner**           — turns analysis into an ordered, actionable plan.
- **Migration Engine**            — performs the migration, composed of:
  **Deterministic Transformer** (AST codemods, Node worker: `codemod-worker`) →
  **AI Resolution Engine** (targeted reasoning over the residue only) →
  **Validator** (runs `tsc` and Metro against the output to prove it works).
- **Reporter**                    — assembles human-readable analysis and migration reports.

## Coding conventions

- **Frontend / TypeScript**: `strict` mode on. No implicit `any`. Prefer functional
  components and hooks. Keep pipeline UI state in Zustand stores under `src/store`.
- **Backend / Python**: fully typed. All data crossing a boundary (API request/response,
  pipeline stage input/output) is a **pydantic** model. Target Python 3.11+.
- The Project Intelligence Engine and Deterministic Transformer are **deterministic**;
  the AI Resolution Engine handles only what rules genuinely cannot.

## Golden rule

> **Always consult [`docs/CONVERSION-RULES.md`](docs/CONVERSION-RULES.md) before
> writing or changing any React → React Native transformation logic.** That table is
> the single source of truth for how patterns map. If a pattern is missing, add a
> row there first, then implement it.
