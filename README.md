# Rejox

**AI-assisted migration from React (web) to React Native.** Rejox resolves by
rules whatever rules can resolve, and invokes AI only where genuine reasoning is
required. It builds a knowledge graph of a React project, scores its
migratability, plans the work, performs the migration with deterministic AST
transforms (plus a scalpel of AI for the residue), validates the output with the
real toolchain (`tsc` + Metro), and hands back a working React Native project.

## Run the web app locally (Upload → Analyze → Report)

The browser UI drives the same pipeline. It runs two services: the FastAPI
backend (:8000) and the Vite dev server (:5173).

**Prerequisites**

- **Python 3.11+**
- **Node 18+** (the deterministic parser/codemod workers run in Node)
- **No `GEMINI_API_KEY` needed** — the Upload → Analyze → Report path is fully
  deterministic and makes zero LLM calls. (A key is only used for the one AI
  step in the full *migrate* flow; see “AI is optional” below.)

**Install** (once)

```bash
# backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -e ".[dev]"

# frontend
cd ../frontend
npm install
cp .env.example .env             # sets VITE_API_URL=http://localhost:8000
```

**Run both services** (one command, from the repo root)

```bash
./dev.sh
```

Then open **http://localhost:5173** and upload a React project (try
`test-projects/sample-app` zipped, or paste a public GitHub URL). `dev.sh`
starts uvicorn and Vite together and stops both on Ctrl+C. CORS origins are
controlled by `REJOX_CORS_ORIGINS` (default `http://localhost:5173,http://127.0.0.1:5173`).

**End-to-end browser test** (real stack, real backend numbers)

```bash
cd frontend
npx playwright install chromium   # once
npm run test:e2e                  # boots both servers, drives a full run
```

The test uploads `test-projects/sample-app`, runs the analysis, and asserts the
Coverage / Confidence / Risk shown on screen equal the live `/api/analyze`
response (and that the score contributions sum to Coverage). Screenshots of all
three screens are written to `docs/screenshots/`.

**Regenerating the API types**

The frontend's TypeScript shapes are **generated** from the backend's OpenAPI
schema — never hand-written — so they cannot silently drift. The generated file
(`frontend/src/types/api.generated.ts`) is committed, so a fresh clone builds
without the backend running. To regenerate after changing a pydantic model:

```bash
# 1. start the backend (so /openapi.json is served)
cd backend && source venv/bin/activate && uvicorn app.main:app --port 8000
# 2. in another shell:
cd frontend && npm run types:gen
```

`npm run types:gen` reads `http://localhost:8000/openapi.json` and rewrites
`src/types/api.generated.ts`. **The backend must be running.** The thin
`src/types/api.ts` only re-exports readable aliases over that generated schema.

**The showcase data + its type**

The home page reads real benchmark numbers from a committed, static JSON —
`frontend/src/data/showcase.json` — produced by an actual pipeline run, never
demo data. Its TypeScript type is likewise **generated**, from the JSON Schema
the export emits alongside the data (`src/data/showcase.schema.json`) — so the
frontend imports `src/types/showcase.generated.ts`, never a hand-written mirror.

Regenerate both in one command each (no backend server needed):

```bash
# 1. re-run the real pipeline on the sample-app benchmark and rewrite
#    frontend/src/data/showcase.json + showcase.schema.json (real parse →
#    analyze → plan → migrate → tsc → Metro; AI forced to the offline `fake`
#    provider so the run is deterministic and byte-reproducible):
cd backend && source venv/bin/activate && rejox export-showcase
# 2. regenerate the .d.ts from the emitted schema:
cd frontend && npm run types:showcase
```

`rejox export-showcase` is byte-deterministic — `generatedAt` is the git commit
date of the `test-projects/sample-app` subtree (override with `SOURCE_DATE_EPOCH`),
not wall-clock. `npm run types:showcase` runs `json2ts` over
`src/data/showcase.schema.json` → `src/types/showcase.generated.ts`. Both the
JSON and the generated type are committed, so `npm run build` works on a fresh
clone with no backend running.

## CLI quick start

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -e .                 # installs the `rejox` CLI
rejox migrate ../test-projects/sample-app
```

That runs the whole pipeline end to end in the terminal:

```
rejox migrate <project-path> [--out <dir>] [--yes] [--no-validate]
```

| Flag | Meaning |
| --- | --- |
| `--out <dir>` | Where to write the React Native project (a temp dir otherwise). |
| `--yes`, `-y` | Accept every recommended answer non-interactively. |
| `--no-validate` | Skip the `tsc` + Metro validation stage (fast). |

### AI is optional

Rejox makes **at most one LLM call** — the navigator *shape* decision, the one
genuine design judgment. Everything else is deterministic.

- `GEMINI_API_KEY=…` → the real provider makes that one call.
- `REJOX_AI_PROVIDER=fake` → an offline provider makes it deterministically (no
  network), useful for demos and CI.
- neither → **AI disabled**: the navigator defaults to a stack and the rest of
  the pipeline is unchanged. Rejox is fully usable with zero AI.

## What a run looks like

`rejox migrate ../test-projects/sample-app --yes` on the bundled sample app
(trimmed):

```text
────────────────────── Intelligence — analyzing the project ──────────────────────
╭─ sample-app — Migration Report ─╮
│ COVERAGE    CONFIDENCE    RISK  │
│   82%          98%        LOW   │
╰─────────────────────────────────╯
Components 21   Pages 4   Routes 4   Endpoints 2   Stores 1

              Coverage — explained (Σ = Coverage)
   +40  Functional components   All 21 components use the MVP-supported architecture…
   +20  Styling surface         Tailwind's mechanical majority maps 1:1 under NativeWind.
   +10  Routing (react-router)  The route table is graph-resolved; links/params convert…
    -4  Hover styling           HOVER_STATE has no clean NativeWind/RN mapping…
    …

──────────────────────── Ask — migration decisions ────────────────────────
AI proposal: a tabs navigator — A persistent 3-link top nav maps to bottom tabs;
detail routes nest in a stack.

Which navigator shape should the app use?
    tabs — Bottom tab navigator (recommended)
    stack — Stack navigator
    drawer — Drawer navigator
  → auto-accepting tabs

────────────────── Migrate — emitting the React Native project ───────────────────
Emitted 27 files → /tmp/rejox-cli-demo
 Residue resolution — by tier
 Static map (rule)     12
 Pattern (rule)        15
 Direct rule            2
 LLM (reasoning)        1
29/30 residue units resolved by rule.  Actual LLM calls: 1  (tokens 132→30)

─────────────────────── Review — validation (tsc + Metro) ────────────────────────
 Install          PASS
 Typecheck (tsc)  PASS    0 error(s)
 Bundle (Metro)   PASS
Validated  Coverage 100%  (strict 58%)   Confidence 97%

────────────────────────────── Done — migration summary ──────────────────────────
Files converted        27
Residue TODOs          13
Validated coverage     100%
Validated confidence   97%
Validation             PASS
LLM calls              1 (tokens 132→30)
Navigator shape        proposed tabs · emitted tabs

╭────────────────── React Native project ───────────────────╮
│ /tmp/rejox-cli-demo                                        │
│ Run it:  cd /tmp/rejox-cli-demo && npx expo start          │
╰────────────────────────────────────────────────────────────╯
```

**It runs.** `tsc` passes and `expo export` (Metro) bundles cleanly — the
migration produces a React Native app you can `npx expo start`. The AI Resolution
Engine runs *inside* emit: CSS Modules become inline `StyleSheet`s (the
`.module.css` is never emitted), `isActive` classNames are static-ized, and the
unsupported-Tailwind residue is rewritten — all before validation. The only
residue that survives is genuinely unresolvable (a runtime `<Link to>`), and it
does not break the build.

**One LLM call.** That number is the whole thesis: the AI is a scalpel used once,
for the one decision that is genuinely design (the navigator shape). Everything
else is resolved by rules. If the build ever did fail, the **repair loop** sends
only the offending line + its diagnostic to the LLM, re-validates, and caps at
two rounds — on `sample-app` it is never needed (zero repair rounds).

## Under the hood

The CLI is a thin face over the pipeline the API already exposes
(`parse → analyze → plan → emit → validate`); it calls the pipeline functions
directly, never over HTTP. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for
the engine design, [`docs/CONVERSION-RULES.md`](docs/CONVERSION-RULES.md) for the
React → RN mapping table, and `CLAUDE.md` for the core principle.

Requirements: Python 3.11+, Node 18+ (the deterministic transforms and CSS/JSX
parsing run in a ts-morph/postcss worker).
