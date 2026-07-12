# Rejox AI — Architecture

## Guiding principle

**Parsing is deterministic. The LLM is a scalpel, not a hammer.**
Everything that can be derived structurally from the source (AST shape, imports,
JSX elements, prop usage) is computed with real parsers. The LLM is only invoked
where AST rules are insufficient — ambiguous layout intent, non-mechanical
refactors, prose in the report.

## Data flow

```
                ┌──────────────┐
   React src ──▶│    Parse     │  Babel / TypeScript Compiler API → AST
                └──────┬───────┘
                       ▼
                ┌──────────────┐
                │ Knowledge    │  Normalized JSON graph of the project:
                │ Graph (JSON) │  files, components, hooks, imports, deps,
                └──────┬───────┘  JSX tree, styling, routes.
                       ▼
                ┌──────────────┐
                │   Analyzer   │  Classifies patterns, flags unsupported ones,
                └──────┬───────┘  scores migratability.
                       ▼
                ┌──────────────┐
                │  Migration   │  Human-readable summary of findings +
                │   Report     │  confidence per area.
                └──────┬───────┘
                       ▼
                ┌──────────────┐
                │     Plan     │  Ordered, concrete steps.
                └──────┬───────┘
                       ▼
                ┌──────────────┐
                │ User choices │  "Ask" stage — resolve ambiguities /
                └──────┬───────┘  unsupported features.
                       ▼
                ┌──────────────┐
                │  Converter   │  AST transforms first; LLM-assisted where
                └──────┬───────┘  deterministic rules fall short.
                       ▼
                ┌──────────────┐
                │  Validator   │  Runs `tsc` + Metro against the OUTPUT
                └──────┬───────┘  project to prove it compiles and boots.
                       ▼
                ┌──────────────┐
                │    Report    │  Final migration report + package for Download.
                └──────────────┘
```

## Stage detail

### Parse
- Tooling: **Babel** (`@babel/parser`) and/or the **TypeScript Compiler API**.
- Output: raw AST per source file. No interpretation happens here.

### Knowledge Graph (JSON)
- A single normalized, serializable JSON document describing the whole project.
- Deterministic and diffable — the contract every later stage reads from.
- Contains: file list, component definitions, hook usage, import/dependency map,
  JSX element trees, styling info (CSS Modules, Tailwind classes), routing.

### Analyzer
- Pure functions over the knowledge graph.
- Detects supported vs unsupported patterns (see `PRD.md`).
- Emits findings with a confidence score; never mutates source.

### Migration Report
- Turns analyzer findings into human-readable prose + tables.
- Reporter agent owns wording; underlying facts come from the graph.

### Plan → User choices (Ask)
- Migration Planner converts findings into an ordered step list.
- Anything ambiguous or unsupported becomes a question for the user.

### Converter
- Applies deterministic AST codemods driven by `docs/CONVERSION-RULES.md`.
- Falls back to LLM assistance **only** where a rule cannot be expressed as a
  mechanical transform (e.g. reflowing a responsive grid into RN layout).

### Validator
- Runs `tsc --noEmit` and a Metro build against the generated RN project.
- Failures loop back with actionable diagnostics; success gates Download.

## Where the LLM is (and isn't) used

| Task                                   | Deterministic AST | LLM |
| -------------------------------------- | :---------------: | :-: |
| Detect imports / dependencies          |         ✅        |     |
| `div`→`View`, `onClick`→`onPress`, etc.|         ✅        |     |
| Build the knowledge graph              |         ✅        |     |
| Run tsc / Metro validation             |         ✅        |     |
| Reflow ambiguous responsive layout     |                   |  ✅ |
| Explain a finding in the report        |                   |  ✅ |
| Resolve genuinely ambiguous intent     |                   |  ✅ |
