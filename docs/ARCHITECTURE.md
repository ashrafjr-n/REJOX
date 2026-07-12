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
- Tooling: a dedicated **Node parser-worker** built on **ts-morph** (a typed
  wrapper over the TypeScript Compiler API) — best-in-class TS/JSX parsing.
- Output: the Knowledge Graph JSON (below). No interpretation, no LLM.
- See **[Parser stage — implementation](#parser-stage--implementation)**.

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

---

## Parser stage — implementation

The Parse stage is implemented as a small **Node worker orchestrated from
Python**. Python never parses JS/TS itself; the worker is the single source of
parsing truth.

```
backend/
├── parser-worker/              # Node + TypeScript (ts-morph)
│   └── src/
│       ├── index.ts            # CLI: node dist/index.js <project> → KG JSON on stdout
│       ├── walk.ts             # file discovery (honours .gitignore; skips node_modules/dist)
│       ├── util.ts             # shared helpers (PascalCase/hook checks, import resolution)
│       ├── types.ts            # TS mirror of the Knowledge Graph schema
│       └── extractors/         # one module per concern
│           ├── imports.ts      # import graph + local-file resolution
│           ├── components.ts   # components: props, hooks, JSX, events, styling
│           ├── hooks.ts        # custom hook definitions + usedBy
│           ├── routes.ts       # react-router <Route> extraction
│           ├── styling.ts      # tailwind / css-module / inline detection
│           ├── api.ts          # axios / fetch clients + endpoints
│           └── state.ts        # zustand stores + state keys
└── app/pipeline/parser.py      # runs the worker via subprocess, validates with pydantic
```

**Contract.** The worker prints a single JSON document (the Knowledge Graph) to
stdout; diagnostics go to stderr. `parser.py::parse_project(path)` runs it,
captures stdout, and validates it into the `KnowledgeGraph` pydantic model
(`app/models/knowledge_graph.py`). The worker is built automatically on first
run (`npm install && npm run build`), or manually:

```bash
cd backend/parser-worker && npm install && npm run build
```

**Determinism.** All collections are sorted and de-duplicated; node ids are
stable (`<file>#<name>`). Anything that can't be resolved statically becomes a
`null` field plus a top-level `warnings` entry — the parser never guesses. A
file with a syntax error yields a warning, not a crash.

### Knowledge Graph schema

Top-level keys (see `types.ts` / `knowledge_graph.py` for the authoritative
definitions):

| Key               | Shape (summary) |
| ----------------- | --------------- |
| `project`         | `{ name, root, framework:"react", language:"ts"|"js"|"mixed", bundler, dependencies:{name:version} }` |
| `files`           | `[{ path, type:"component"|"hook"|"store"|"api"|"style"|"config"|"asset"|"other", loc }]` |
| `components`      | `[{ id, name, file, exportType, props:[{name,type,optional}], hooksUsed, childComponents, jsxElements:{tag:count}, eventHandlers, stylingApproach:["tailwind"|"css-module"|"inline"|"none"], tailwindClasses, cssModuleImports, webApis }]` |
| `hooks`           | `[{ id, name, file, isCustom, usedBy }]` (project-defined custom hooks) |
| `routes`          | `[{ path, componentName, file, hasParams, params }]` |
| `stateManagement` | `{ library:"zustand"|"context"|"none", stores:[{ id, name, file, stateKeys, usedBy }] }` |
| `apiLayer`        | `{ clients:[{ id, library:"axios"|"fetch", file, baseURL }], endpoints:[{ method, url, file }] }` |
| `assets`          | `[{ path, type, referencedBy }]` |
| `edges`           | `[{ from, to, kind:"renders"|"imports"|"uses-hook"|"uses-store"|"calls-api" }]` |
| `warnings`        | `[string]` — anything unresolved or non-fatally wrong |

Every node carries a stable `id` (`<file>#<name>`); `edges` reference those ids
(and file paths for `imports`/`calls-api`). A pretty-printed real example lives
at `backend/tests/fixtures/sample-app.kg.json`.

### Known limitations (feed the Analyzer)

These are the patterns the extractors do **not** fully resolve yet. They are
listed honestly so the Analyzer stage can account for them:

- **Object-config routers** (`createBrowserRouter([...])`) are not parsed; only
  the JSX `<Route>` form is. A warning is emitted when the object form is seen.
- **Endpoint detection is call-site based**: URLs built entirely from variables
  (no static string/template part) are recorded as `url: null`.
- **Prop types** are read from a component's own parameter type / local
  interface only; props inherited via `extends` (e.g. `ButtonHTMLAttributes`)
  are not expanded.
- **Styling from computed class names**: tokens are resolved from string/
  template literals and locally-referenced variables/objects, but classes
  produced by helper calls (e.g. a `clsx`/`cva` runtime) or spread from props
  are not fully captured.
- **Context / Redux state**: only Zustand stores get `stateKeys`. React Context
  is flagged (`library:"context"`) but not deeply modeled; Redux is out of MVP
  scope entirely.
- **Non-import asset references** (assets referenced by string URL rather than a
  JS import) are listed as assets with an empty `referencedBy`.

---

## Analyzer stage — implementation

The Analyzer is **pure, deterministic functions over the Knowledge Graph**. No
LLM, no source re-parsing — every finding traces to a KG fact (if a fact is
missing, it is added to the Node worker first; that is why the KG carries
`webApis`). Entry point:

```python
from app.pipeline.analyzer import analyze_graph   # analyze_graph(kg) -> AnalysisReport
```

```
backend/app/pipeline/
├── analyzer.py           # composes the rules into an AnalysisReport
└── rules/
    ├── codes.py          # stable issue codes (report contract)
    ├── libraries.py      # KNOWN_LIBRARIES table → LibraryFinding[]
    ├── components.py      # ELEMENT_MAP / EVENT_MAP → per-component issues
    ├── styling.py         # Tailwind class classifier + styling report
    ├── routing.py         # react-router → proposed React Navigation stack
    └── scoring.py         # sub-scores + weighted migration score
```

### Rule groups

- **Library rules** — a declarative `KNOWN_LIBRARIES` table (data, not code)
  gives each dependency a category/status/compatibility and RN equivalents.
  Findings come from `project.dependencies` **plus** usage-derived signals the
  KG carries: Tailwind (from `stylingApproach`) and the bundler
  (`project.bundler`). The PRD "NOT supported" list (redux, three.js, next,
  electron…) maps to `status:"unsupported"` → a **blocker**. Unknown deps →
  `status:"unknown"` (never guessed).
- **Component rules** — per component: web-only JSX elements via a declarative
  `ELEMENT_MAP` (div→View trivial/silent, img→Image info, `table`/`canvas`/
  `iframe`→**blocker**); event handlers via `EVENT_MAP` (onClick→onPress info,
  onSubmit/onMouse*→warning); Tailwind classes classified against NativeWind
  support (`hover:`/`grid`/`group`/gradient → unmappable); CSS Modules →
  warning; dynamic className (tailwind approach but 0 static classes) → warning;
  and `WEB_API_USAGE` from `component.webApis`.
- **Routing rules** — react-router → a `needs-conversion` finding plus a proposed
  React Navigation stack (screen name + params per route). A worker
  `createBrowserRouter` warning surfaces as an `OBJECT_ROUTER_UNPARSED` blocker.

### Score formula

Each sub-score is a pure function of findings, `0-100` (higher = more
migratable), combined by fixed weights that sum to `1.0`:

```
migrationScore = 0.40·components + 0.25·libraries + 0.20·styling
               + 0.10·routing    + 0.05·api
```

- **components** = mean of per-component scores. A component's score is
  `100 − Σ penalty` where `info=2, warning=10, blocker=40`; any blocker forces
  difficulty `blocked` (score capped at 20). Buckets: `≥90 trivial · ≥75 easy ·
  ≥55 medium · <55 hard`.
- **libraries** = mean `compatibility` across findings.
- **styling** = `100 −` per-component penalties for grid(3)/hover(2)/responsive(1)
  /gradient(2)/group(2)/css-module(4)/dynamic(5).
- **routing** = `100` if no router, else `80 − 20·(object-router blockers)`.
- **api** = `100 − 10·(endpoints with an unresolved URL)`.

On the benchmark `sample-app`, this yields **migrationScore ≈ 83.6**
(components 91.8, libraries 85.7, styling 62.0, routing 80.0, api 100.0).
