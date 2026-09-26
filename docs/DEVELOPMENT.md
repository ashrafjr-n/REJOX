# Developing Rejox

Everything needed to work **on** Rejox from a checkout: the web app, the tests,
and the generated artifacts. To just *use* Rejox, see the [README](../README.md).

## Run the web app locally (Upload → Analyze → Report)

The browser UI drives the same pipeline. It runs two services: the FastAPI
backend (:8000) and the Vite dev server (:5173).

**Prerequisites**

- **Python 3.11+**
- **Node 20+** (the deterministic parser/codemod workers run in Node; installing
  the backend bundles them with esbuild, so `npm` must be on PATH)
- **No `GEMINI_API_KEY` needed** — the Upload → Analyze → Report path is fully
  deterministic and makes zero LLM calls. (A key is only used for the one AI
  step in the full *migrate* flow; see “AI is optional” below.)

**Install** (once)

```bash
# backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -e ".[dev,server]"

# frontend
cd ../frontend
npm install
cp .env.example .env             # leaves VITE_API_URL empty — same origin
```

**Run both services** (one command, from the repo root)

```bash
./dev.sh
```

Then open **http://localhost:5173** and upload a React project (try
`test-projects/sample-app` zipped, or paste a public GitHub URL). `dev.sh`
starts uvicorn and Vite together and stops both on Ctrl+C. CORS origins are
controlled by `REJOX_CORS_ORIGINS` (default `http://localhost:5173,http://127.0.0.1:5173`).

> **`dev.sh` is a local-only posture.** Validating a migration runs the uploaded
> project's `npm install`, `tsc` and Metro, so a server that accepts uploads
> must run them contained (`REJOX_SANDBOX=docker`) and behind an API key
> (`REJOX_API_KEYS`). `dev.sh` sets `REJOX_ALLOW_ANONYMOUS=1`,
> `REJOX_ALLOW_UNSANDBOXED=1` and `REJOX_ALLOW_LOCAL_PATH=1` because it binds to
> `127.0.0.1` and migrates projects you chose yourself. Without those, the API
> returns 503 — or 403 for a local `path` — and explains what to set. Read
> **[`docs/SECURITY.md`](SECURITY.md)** before deploying this anywhere — it
> lists both the guarantees and the known gaps.

`dev.sh` runs anonymous on purpose — it is the fast path, and it never exercises
sign-in. To work on the real session flow locally, use **`./dev-local.sh`**
instead: same two services, one command, plus the three variables a session
needs.

```bash
chmod +x dev-local.sh
./dev-local.sh          # then sign in at :5173 with  my-code-2026
```

It sets `REJOX_INVITE_CODES` (unset, the server has no valid code and rejects
every one), `REJOX_SESSION_SECRET` (unset, `/api/session` answers 503 — there is
deliberately no baked-in default) and `REJOX_COOKIE_INSECURE=1`, on top of the
three flags `dev.sh` already exports. The signing secret is generated once into
`backend/.env.dev-local` (gitignored) so a restart does not sign you out, and
the invite code is overridable: `INVITE_CODE=something ./dev-local.sh`.

It also forces `VITE_API_URL` empty, belt to `.env.example`'s braces. Pointing
it at `http://localhost:8000` makes it a **different origin** from the app on
`:5173`, and the `SameSite=Lax` session cookie is never sent cross-origin — so
sign-in appears to succeed and then silently never sticks. Same-origin through
the Vite proxy is the only shape in which the cookie works, and `sign-in.spec.ts`
fails loudly if that ever changes.

The session cookie is `Secure`, so a browser will not send it back over plain
`http` — `REJOX_COOKIE_INSECURE=1` drops that for local work. It is refused
unless `REJOX_ALLOW_ANONYMOUS=1` is also set, which is what stops it being
switched on by accident on a server that is otherwise configured for real use.
Sign-in still works normally: with invite codes configured, anonymous access is
never reached. The dev server proxies `/api` to the backend, so the browser sees
one origin and `SameSite=Lax` behaves exactly as it does in production.

**End-to-end browser test** (real stack, real backend numbers)

```bash
cd frontend
npx playwright install chromium   # once
npm run test:e2e                  # boots both servers, drives a full run
```

The stack it boots is **not anonymous**: invite codes are configured, so the
browser authenticates with a session cookie exactly as it does in production.
`sign-in.spec.ts` drives that gate by hand — gated when signed out, a wrong code
refused, a valid one signing in and surviving a page reload — and the rest of the
suite starts from a session established once by the `setup` project.

The main test uploads `test-projects/sample-app`, runs the analysis, and asserts
the Coverage / Confidence / Risk shown on screen equal the live `/api/analyze`
response (and that the score contributions sum to Coverage). Screenshots of all
three screens are written to `docs/screenshots/`.

**Regenerating the API types**

The frontend's TypeScript shapes are **generated** from the backend's OpenAPI
schema — never hand-written — so they cannot silently drift. The generated file
(`frontend/src/types/api.generated.ts`) is committed, so a fresh clone builds
without the backend running. To regenerate after changing a pydantic model:

```bash
# 1. start the backend (so /openapi.json is served)
cd backend && source venv/bin/activate && uvicorn rejox.server.main:app --port 8000
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

**The sample-app Knowledge Graph fixture**

`backend/tests/fixtures/sample-app.kg.json` is the graph most of the test suite
reads instead of re-parsing the benchmark. It is generated too — never
hand-edited:

```bash
cd backend && source venv/bin/activate && rejox export-graph
```

That runs the real parser-worker over `test-projects/sample-app` and rewrites the
fixture, byte-deterministically and with `project.root` written repo-relative so
no machine's home directory is committed. `--project <path>` parses something
else; `--out <file>` writes elsewhere. `backend/tests/test_parser.py` parses for
real on every run and fails when the committed fixture no longer matches, so it
cannot age silently behind the benchmark.

## Learning the codebase

Start with [`ARCHITECTURE.md`](ARCHITECTURE.md) for the engine design and
[`CONVERSION-RULES.md`](CONVERSION-RULES.md) for how every React pattern maps to
React Native. [`TESTING-LOG.md`](../TESTING-LOG.md) records the real projects
Rejox has been run against and what each one taught it.
