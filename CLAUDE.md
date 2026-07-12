# Rejox AI

Rejox AI is an **AI migration engineer** that converts React (web) projects into
React Native applications. Users upload a React codebase; Rejox analyzes it,
proposes a migration plan, asks clarifying questions, performs the conversion
with a mix of deterministic AST transforms and LLM assistance, validates the
output, and hands back a working React Native project plus a report.

## Monorepo layout

```
rejox/
├── CLAUDE.md            # this file
├── docs/                # product + engineering docs (read these first)
├── frontend/            # Rejox web app (Vite + React + TS + Tailwind)
├── backend/             # FastAPI + pipeline engine (Python 3.11+)
└── test-projects/
    └── sample-app/      # benchmark React app used to test migrations
```

## The 8-stage pipeline

Every migration flows through these stages, in order:

1. **Upload**   — user submits a React project (zip / repo).
2. **Analysis** — parse the source into a deterministic knowledge graph.
3. **Report**   — summarize what the project uses and how migratable it is.
4. **Plan**     — produce a concrete, ordered migration plan.
5. **Ask**      — surface decisions that need human input (ambiguities, unsupported bits).
6. **Migrate**  — apply AST transforms + LLM-assisted conversion.
7. **Review**   — validate the output (tsc + Metro) and self-review changes.
8. **Download** — package the converted React Native project + final report.

## Agent architecture

The pipeline is driven by a set of focused agents:

- **Planner**            — orchestrates the pipeline and sequences the other agents.
- **Analyzer**           — walks the knowledge graph to understand the project.
- **Library Detector**   — identifies dependencies and maps them to RN equivalents.
- **Migration Planner**  — turns analysis into an ordered, actionable plan.
- **Converter**          — performs the actual React → React Native transformation.
- **Validator**          — runs `tsc` and Metro against the output to prove it works.
- **Reporter**           — assembles human-readable analysis and migration reports.

## Coding conventions

- **Frontend / TypeScript**: `strict` mode on. No implicit `any`. Prefer functional
  components and hooks. Keep pipeline UI state in Zustand stores under `src/store`.
- **Backend / Python**: fully typed. All data crossing a boundary (API request/response,
  pipeline stage input/output) is a **pydantic** model. Target Python 3.11+.
- Keep parsing **deterministic**; reserve the LLM for cases AST rules cannot cover.

## Golden rule

> **Always consult [`docs/CONVERSION-RULES.md`](docs/CONVERSION-RULES.md) before
> writing or changing any React → React Native conversion logic.** That table is
> the single source of truth for how patterns map. If a pattern is missing, add a
> row there first, then implement it.
