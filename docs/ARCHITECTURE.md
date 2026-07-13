# Rejox AI — Architecture

## Guiding principle

**Rejox AI is an AI-assisted migration system that combines deterministic code
transformation with targeted AI reasoning to safely migrate React applications
into React Native.**

**Core principle: resolve by rules whatever rules can resolve. Invoke AI only
where genuine reasoning is required.** Everything that can be derived
structurally from the source (AST shape, imports, JSX elements, prop usage) is
computed with real parsers and transformed with real codemods. The AI Resolution
Engine is only invoked over the residue — ambiguous layout intent,
non-mechanical refactors, prose in the report. Rejox is never a "code
converter"; every new capability must first be attempted deterministically.

## Data flow

```
                ┌──────────────────┐
   React src ──▶│     Project      │  Parser + dependency scanner + AST builder
                │   Intelligence   │  + metadata extractor + graph builder
                │      Engine      │  (Node parser-worker, ts-morph).
                └────────┬─────────┘
                         ▼
                ┌──────────────────┐
                │  Knowledge Graph │  Normalized JSON graph of the project:
                │      (JSON)      │  files, components, hooks, imports, deps,
                └────────┬─────────┘  JSX tree, styling, routes.
                         ▼
                ┌──────────────────┐
                │     Analyzer     │  Classifies patterns, assesses domain risk,
                └────────┬─────────┘  computes Coverage / Confidence / Risk.
                         ▼
                ┌──────────────────┐
                │ Migration Report │  Human-readable summary of findings +
                └────────┬─────────┘  the explainable score breakdown.
                         ▼
                ┌──────────────────┐
                │       Plan       │  Ordered, concrete steps.
                └────────┬─────────┘
                         ▼
                ┌──────────────────┐
                │   User choices   │  "Ask" stage — resolve ambiguities /
                └────────┬─────────┘  unsupported features.
                         ▼
                ┌──────────────────────────────────────────┐
                │             Migration Engine             │
                │ ┌──────────────┐ ┌────────────┐ ┌──────┐ │
                │ │Deterministic │▶│ AI Resolut.│▶│Valid.│ │
                │ │ Transformer  │ │   Engine   │ │      │ │
                │ └──────────────┘ └────────────┘ └──────┘ │
                │  AST codemods →  residue only →  tsc +   │
                │  (codemod-worker)  (next)        Metro   │
                └────────────────────┬─────────────────────┘
                                     ▼
                ┌──────────────────┐
                │      Report      │  Final migration report + package for
                └──────────────────┘  Download.
```

## Stage detail

### Project Intelligence Engine
- Parser + dependency scanner + AST builder + metadata extractor + graph
  builder in one deterministic stage.
- Tooling: a dedicated **Node parser-worker** built on **ts-morph** (a typed
  wrapper over the TypeScript Compiler API) — best-in-class TS/JSX parsing.
  (The worker directory keeps the name `parser-worker`.)
- Output: the Knowledge Graph JSON (below). No interpretation, no LLM.
- Python module: `app/pipeline/intelligence.py` (`build_knowledge_graph`).
- See **[Project Intelligence Engine — implementation](#project-intelligence-engine--implementation)**.

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

### Migration Engine
Composed of three sub-engines, run in order:

1. **Deterministic Transformer** — AST codemods driven by
   `docs/CONVERSION-RULES.md` (the Node codemod-worker). Resolves everything
   rules can resolve; records the rest as `unhandled`.
2. **AI Resolution Engine** *(next session — not yet implemented)* — targeted
   reasoning over the `unhandled` residue **only**, never the default path.
3. **Validator** — runs `tsc --noEmit` and a Metro build against the generated
   RN project. Failures loop back with actionable diagnostics; success gates
   Download.

## Where the AI Resolution Engine is (and isn't) used

| Task                                   | Deterministic rules | AI  |
| -------------------------------------- | :-----------------: | :-: |
| Detect imports / dependencies          |         ✅          |     |
| `div`→`View`, `onClick`→`onPress`, etc.|         ✅          |     |
| Build the knowledge graph              |         ✅          |     |
| Navigation links / params (route table)|         ✅          |     |
| Tailwind → NativeWind (supported set)  |         ✅          |     |
| Run tsc / Metro validation             |         ✅          |     |
| Reflow ambiguous responsive layout     |                     |  ✅ |
| Explain a finding in the report        |                     |  ✅ |
| Resolve genuinely ambiguous intent     |                     |  ✅ |

---

## Project Intelligence Engine — implementation

The stage is implemented as a small **Node worker orchestrated from Python**
(the worker directory keeps the name `parser-worker`). Python never parses
JS/TS itself; the worker is the single source of parsing truth.

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
└── app/pipeline/intelligence.py  # runs the worker via subprocess, validates with pydantic
```

**Contract.** The worker prints a single JSON document (the Knowledge Graph) to
stdout; diagnostics go to stderr. `intelligence.py::build_knowledge_graph(path)` runs it,
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

On the benchmark `sample-app`, this yields **migrationScore ≈ 81.1**
(components 85.7, libraries 85.7, styling 62.0, routing 80.0, api 100.0) — the
component sub-score dropped from ~91.8 once the Converter-Part-1 conversion
rules (MISSING_TEXT_WRAP, IMPLICIT_FLEX_ROW, UNSIZED_IMAGE) began firing.

---

## Planner stage — implementation

The Planner turns an `AnalysisReport` (plus the KG it came from) into an ordered
**Migration Plan** and the **Questions** the Ask stage puts to the user. Pure and
deterministic — it plans, it does not convert. Entry point:

```python
from app.pipeline.planner import plan_migration   # plan_migration(report, kg) -> MigrationPlan
```

Schema in `app/models/plan.py`: `Question` / `QuestionOption` / `PlanStep`
(`kind ∈ setup|routing|components|styling|state|api|assets|navigation|validation`)
/ `ManualReviewCandidate` / `UnsupportedItem` / `MigrationPlan`. The API returns a
`PlanResponse { report, plan }` so the frontend gets both together.

### Question-generation rules

A question is emitted **only** when a finding justifies it, and exactly one
option per question is recommended (rule in parentheses):

| Question | Emitted when | Recommended (why) |
| -------- | ------------ | ----------------- |
| `project-type` | always | **Expo** — fastest path to a runnable MVP app |
| `styling-engine` | `styling.tailwindClassCount > 0` | **NativeWind** — Tailwind is the dominant approach; preserves the most classes |
| `navigation-library` | `routing.library` set (react-router) | **React Navigation** — mature, works with Expo *and* bare RN |
| `icons` | an icon library is in `dependencies` | **@expo/vector-icons** — zero-config in Expo |
| `storage` | `localStorage`/`sessionStorage` in a component's `webApis` | **AsyncStorage** — the standard RN key-value store |

Every `context` string cites real numbers from the report (e.g. *"138 Tailwind
classes across 20 components (18 unmappable), 1 CSS Module"*).

### Step-ordering algorithm

Steps are derived from the report, not hardcoded, and a **content step with no
targets is omitted** (no router → no routing/navigation step, no stores → no
state step, etc.). Emission order (which sets `order` and the `dependsOn` DAG):

```
setup → routing → state → api → component-waves… → styling → assets
      → navigation → validation
```

- **setup** is always first (`affectedByQuestions` = all questions);
  **validation** is always last (depends on every prior step).
- **Component conversion is split into dependency waves** via the KG `renders`
  edges, using Kahn's algorithm: a component is placed in a wave only once every
  component it renders is already placed — so **leaf/shared components convert
  first and pages last**. Each wave is one `components` step depending on the
  previous wave. A render cycle (recursive components) is placed as one
  deterministic final wave rather than looping.
- `manualReviewCandidates` = every component with difficulty medium/hard/blocked
  **plus** every `CSS_MODULE` / `DYNAMIC_CLASSNAME` target, each with its reason.
- `unsupportedItems` = each `unsupported` library with a concrete suggestion
  (e.g. redux → *"Port state to zustand before conversion"*).

On the benchmark `sample-app` this produces **3 questions** (project-type,
styling-engine, navigation-library) and **13 steps**, with the 21 components
split into **5 render-topology waves of [9, 5, 4, 2, 1]** (Button/Rating/Spinner
→ … → ProductCard → ProductGrid → ProductsPage → App).

---

## Converter stage — Part 1 (deterministic)

The Converter runs in two parts. **Part 1 (this stage) is fully deterministic —
no LLM.** It builds every mechanical transform; only what AST rules genuinely
cannot express is recorded in an `unhandled` list for **Part 2 (LLM-assisted)**.

### Two-worker design

Parsing and codemodding both stay in Node (best-in-class TS/JSX tooling),
orchestrated from Python via subprocess — the same pattern for both:

```
backend/
├── parser-worker/     # React → Knowledge Graph (facts)          → app/pipeline/parser.py
├── codemod-worker/    # one React file → one React Native file   → app/pipeline/converter.py
│   └── src/transforms/{links,events,elements,text,imports}.ts    # composable, ordered
└── app/pipeline/
    ├── scaffold.py    # Expo(TS) project skeleton from answers (templates/)
    └── converter.py   # convert_component(file, options) -> ConversionResult
```

The parser-worker feeds the codemod the **conversion facts** it is blind
without (added to the KG in Part 1): `textNodes` (bare text → the #1 silent RN
bug), `layoutHints` (web flex = row, RN = column), `images` (explicit size /
`src` kind), `inlineStyles` (RN-incompatible CSS props). New Analyzer rules —
`MISSING_TEXT_WRAP`, `IMPLICIT_FLEX_ROW`, `UNSIZED_IMAGE`,
`RN_INCOMPATIBLE_CSS_PROP` — score off these.

### Codemod transform order

`links → events → elements → text → imports`. Events run while host tags are
still lowercase, so custom components are never touched; text-wrapping runs
after element renames so parent tags are already RN. Each transform is
idempotent and re-queries the tree after every edit (avoids stale ts-morph
node refs).

### Output contract — `unhandled` → LLM (Part 2)

The codemod-worker prints one JSON document:

```json
{ "file": "...", "code": "<RN source>",
  "warnings": [{ "code", "message", "line" }],
  "unhandled": [{ "code", "snippet" }] }
```

- **`code`** is guaranteed **syntactically valid TS** — the worker re-parses its
  own output and refuses to emit on any syntax error.
- **`unhandled`** is precisely the Part-2 spec: everything the deterministic
  pass could not safely resolve (`NAV_LINK`, `NAV_ACTIVE`, `NAV_HOOK`,
  `CSS_MODULE`, `IMAGE_PROPS`, `PROPS_HTML_TYPE`, `EVENT_ADAPTER`,
  `WEB_ONLY_ELEMENT`). Each also leaves a `// REJOX-TODO(<CODE>)` comment in the
  output, so nothing is ever silently dropped.

### Scaffold

`generate_scaffold(out_dir, answers, source_dependencies)` renders an Expo (TS)
skeleton from the answered questions, wiring NativeWind (babel `jsxImportSource`
+ `nativewind/babel`, metro `withNativeWind` + `global.css`, `tailwind.config.js`)
and the chosen navigation library, carrying over compatible deps (zustand,
axios). Templates are real files under `app/pipeline/templates/`. No source is
copied — skeleton only.

On the benchmark `sample-app`, **14 of 21 components convert with zero unhandled
items**; the remainder concentrate on navigation (`NAV_LINK`×7, `NAV_ACTIVE`,
`NAV_HOOK`), images (`IMAGE_PROPS`×3), one CSS Module, and one web DOM prop type
— that list is the Part 2 backlog.
