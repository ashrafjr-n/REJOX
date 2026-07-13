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
    ├── domains.py         # DOMAIN_TABLE → functional-domain risk assessment
    └── scoring.py         # Coverage contributions + provenance Confidence
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

### Domain Risk Assessment (`rules/domains.py`)

Classifies **functional domains** — capabilities, a level above libraries and
components. A declarative `DOMAIN_TABLE` drives it; detection is
**evidence-based from the KG only**: a domain triggers on a *dependency*
signal or an *API endpoint / route* signal — component names and web-API usage
merely corroborate, never trigger. Domains with no signal are simply absent,
never "unknown".

| Domain          | Risk   | Why                                                        |
| --------------- | ------ | ---------------------------------------------------------- |
| authentication  | High   | secure storage, deep-link OAuth, biometrics, no cookies in RN |
| payments        | High   | platform payment SDKs; app-store IAP rules                 |
| file-upload     | High   | no `<input type=file>`; expo-image-picker/document-picker  |
| maps            | Medium | react-native-maps has a different API surface              |
| realtime        | Medium | WebSockets vs app backgrounding / network switching        |
| media           | Medium | video/audio playback is a native module (expo-av)          |
| animations      | Medium | framer-motion → Moti/Reanimated re-authoring               |
| charts          | Low    | victory-native / react-native-svg equivalents exist        |
| i18n            | Low    | i18next/react-intl run in RN; locale detection differs     |

**Overall project Risk = the worst detected domain risk; "low" when no domain
is detected** (documented rule: `overall_risk`).

### Scoring: Coverage · Confidence · Risk

The old single `migrationScore` conflated two independent axes and was
replaced. The report now carries three:

**Coverage (0-100)** — *how much of the project can be migrated.* Built as an
explainable list of `ScoreContribution { label, delta, reason, evidence }`
rows whose **signed deltas sum exactly to the figure** (base 0). Positive rows
grant fixed area budgets; every deduction is an itemized, evidenced negative
row:

```
budgets:    components 40 · libraries 25 · styling 20 · routing 10 · api 5
components: +40, then per issue code −(attributed shortfall)·40/(100·N),
            where each component's shortfall (100−score) is attributed to its
            issues proportionally to severity penalties (info=2, warning=10,
            blocker=40; a blocker caps the component score at 20 → "blocked")
libraries:  each library is its own positive row: +25·compatibility/(100·M)
styling:    +20, then −20·penalty·count/100 per code
            (grid 3 · hover 2 · responsive 1 · gradient 2 · group 2 ·
             css-module 4 · dynamic 5)
routing:    +10 (or "+10 No web router"), −2 router conversion overhead,
            −2 per unparsed object-config router
api:        +5, −0.5 per endpoint with an unresolved URL
```

**Confidence (0-100)** — *how sure we are that what WAS migrated is correct.*
Computed **from provenance, never estimated**, via the `ConfidenceSource` enum
(the AI values are reserved so the AI Resolution Engine plugs in without
schema churn):

| Provenance                          | Confidence |
| ----------------------------------- | ---------- |
| `deterministic` (rule, no warning)  | 100        |
| `deterministic-warning`             | 80         |
| `ai-validated` (reserved)           | 65         |
| `ai-failed` (reserved)              | 0          |
| `unhandled` (residue)               | excluded — counts against Coverage |

`PROVENANCE_BY_CODE` maps every issue code to what the Deterministic
Transformer actually does with it today. Each non-blocked component
contributes one baseline `deterministic` unit (its mechanical conversion) plus
one unit per issue; blocked components contribute nothing (not migrated at
all — Coverage's business). Confidence = mean over included units.

**Risk** — the worst detected functional-domain risk (see above).

On the benchmark `sample-app`: **Coverage 82.5 · Confidence 97.7 · Risk low**.
The two figures are deliberately different — the project is deterministic-
heavy (high confidence in what converts) while hover/grid/CSS-Module residue
drags Coverage down. A single conflated score hid exactly that distinction.

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

## Migration Engine — Deterministic Transformer

The first sub-engine of the Migration Engine. **Fully deterministic — no AI.**
It resolves everything rules can resolve; only what genuinely requires
judgment is recorded in `unhandled` — that list is the entire input contract
of the AI Resolution Engine (next).

### Two-worker design

Parsing and codemodding both stay in Node (best-in-class TS/JSX tooling),
orchestrated from Python via subprocess — the same pattern for both:

```
backend/
├── parser-worker/     # React → Knowledge Graph (facts)          → app/pipeline/intelligence.py
├── codemod-worker/    # one React file → one React Native file   → app/pipeline/transformer.py
│   └── src/transforms/{navigation,events,elements,images,text,styles,propsTypes,imports}.ts
└── app/pipeline/
    ├── scaffold.py    # Expo(TS) project skeleton from answers (templates/)
    └── transformer.py # build_transform_options(kg, report, answers) → options
                       # transform_component(file, options) -> TransformResult
```

The Project Intelligence Engine feeds the codemod everything it would
otherwise be blind to:

- **conversion facts** in the KG: `textNodes` (bare text → the #1 silent RN
  bug), `layoutHints` (web flex = row, RN = column), `images` (explicit size /
  `src` kind), `inlineStyles` (RN-incompatible CSS props), `propsExtends`
  (DOM-derived props);
- **graph-derived options** built by `build_transform_options`:
  - `routes` — the normalized route table (`/products/:id` → screen
    `ProductDetail`, params `[id]`), which makes `<Link to>` →
    `navigation.navigate()` a rule for static, param, and template paths;
  - `componentEvents` — project components whose props the graph PROVES are
    DOM-derived (`propsExtends` ∋ `*HTMLAttributes`) get `onClick → onPress`
    renamed at every call site, consistent with the definition side
    (`extends ButtonHTMLAttributes` → `extends PressableProps`). A component's
    own `(value) => void` API is never touched.

### Transform order

`navigation → events → elements → images → text → styles → propsTypes →
imports`. Navigation runs first while `<Link>`/`useParams` are intact; events
run while host tags are still lowercase (only graph-proven project components
are touched); images run after elements (`img` is already `<Image>`);
text-wrapping runs after renames so parent tags are already RN; imports run
last over the fully-transformed file. Each transform is idempotent and
re-queries the tree after every edit (avoids stale ts-morph node refs).

### Output contract — `unhandled` → AI Resolution Engine

The codemod-worker prints one JSON document:

```json
{ "file": "...", "code": "<RN source>",
  "warnings": [{ "code", "message", "line" }],
  "unhandled": [{ "code", "snippet" }] }
```

- **`code`** is guaranteed **syntactically valid TS** — the worker re-parses its
  own output and refuses to emit on any syntax error.
- **`unhandled`** is precisely the AI Resolution Engine's spec: ONLY items that
  genuinely require judgment. Each also leaves a `// REJOX-TODO(<CODE>)`
  comment in the output, so nothing is ever silently dropped.

### The honest residue (benchmark `sample-app`)

After the deterministic layer is pushed as far as it honestly goes, the full
residue — per component, per code — is:

| File                  | Residue                                                       |
| --------------------- | ------------------------------------------------------------- |
| App                   | `NAV_CONTAINER` ×2 (`Routes`, `Route` — navigator structure)  |
| Layout                | `NAV_CONTAINER` (`Outlet`)                                    |
| Navbar                | `NAV_LINK` (`to={link.to}` is a runtime value) · `NAV_ACTIVE` (isActive styling) · `TW_UNSUPPORTED` (backdrop-blur, hover:, sticky, transition) |
| ProductCard           | `CSS_MODULE` · `TW_UNSUPPORTED` (hover:)                      |
| Button                | `TW_UNSUPPORTED` (hover: ×2, transition-colors)               |
| ProductGrid           | `TW_UNSUPPORTED` (grid + responsive grid-cols)                |
| Hero                  | `TW_UNSUPPORTED` (bg-gradient, from-, to-, hover:)            |
| Spinner               | `TW_UNSUPPORTED` (animate-spin)                               |
| CartBadge / CartItem / QuantityStepper | `TW_UNSUPPORTED` (hover:)                    |
| CartSummary / SettingsPage | `TW_UNSUPPORTED` (divide-y)                              |
| FeatureCard / SettingToggle | `TW_UNSUPPORTED` (hover:shadow, transitions)            |
| HomePage / ProductDetailPage | `TW_UNSUPPORTED` (grid, hover:)                        |
| ErrorMessage · Footer · Rating · ProductsPage | **zero residue**                      |

Everything that used to be residue but was actually a rule is now closed:
`NAV_LINK` static/param/template paths (was ×7), `NAV_HOOK`/`useParams`,
`IMAGE_PROPS` (×3), `PROPS_HTML_TYPE`, and the mechanical majority of Tailwind.
What remains is precisely the work that needs reasoning: navigator structure
(design), active-state styling (design), one stylesheet re-expression, and the
web-only utility classes (pressed states, flex reflow, gradients, animations).

### Scaffold

`generate_scaffold(out_dir, answers, source_dependencies)` renders an Expo (TS)
skeleton from the answered questions, wiring NativeWind (babel `jsxImportSource`
+ `nativewind/babel`, metro `withNativeWind` + `global.css`, `tailwind.config.js`)
and the chosen navigation library, carrying over compatible deps (zustand,
axios). Templates are real files under `app/pipeline/templates/`. No source is
copied — skeleton only.
