# Rejox AI

**AI-assisted migration from React (web) to React Native.** Rejox resolves by
rules whatever rules can resolve, and invokes AI only where genuine reasoning is
required. It builds a knowledge graph of a React project, scores its
migratability, plans the work, performs the migration with deterministic AST
transforms (plus a scalpel of AI for the residue), validates the output with the
real toolchain (`tsc` + Metro), and hands back a working React Native project.

## Quick start

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
 Typecheck (tsc)  FAIL    3 error(s)     ← all map to known residue (NAV_ACTIVE, CSS_MODULE)
Validated  Coverage 92%  (strict 38%)   Confidence 96%

────────────────────────────── Done — migration summary ──────────────────────────
Files converted        27
Residue TODOs          30
Validated coverage     92%
Validated confidence   96%
LLM calls              1 (tokens 132→30)
Navigator shape        proposed tabs · emitted stack (validated default)

╭────────────────── React Native project ───────────────────╮
│ /tmp/rejox-cli-demo                                        │
│ Run it:  cd /tmp/rejox-cli-demo && npx expo start          │
╰────────────────────────────────────────────────────────────╯
```

**One LLM call.** That number is the whole thesis: 29 of 30 residue units are
resolved by rules (static map, pattern, direct rule); the AI is a scalpel used
once, for the one decision that is genuinely design. The remaining `tsc`
diagnostics are all expected residue (the deterministic emit leaves
`REJOX-TODO`s that the AI Resolution Engine's resolvers target); wiring those
resolvers into emit is the repair loop.

## Under the hood

The CLI is a thin face over the pipeline the API already exposes
(`parse → analyze → plan → emit → validate`); it calls the pipeline functions
directly, never over HTTP. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for
the engine design, [`docs/CONVERSION-RULES.md`](docs/CONVERSION-RULES.md) for the
React → RN mapping table, and `CLAUDE.md` for the core principle.

Requirements: Python 3.11+, Node 18+ (the deterministic transforms and CSS/JSX
parsing run in a ts-morph/postcss worker).
