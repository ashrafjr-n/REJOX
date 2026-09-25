# rejox

**AI-assisted migration from React (web) to React Native.** Rejox resolves by
rules whatever rules can resolve, and invokes AI only where genuine reasoning
is required — at most **one LLM call** per migration. It builds a knowledge
graph of a React project, scores its migratability, plans the work, performs
the migration with deterministic AST transforms, validates the output with the
real toolchain (`tsc` + Metro), and hands back a working React Native project.

See the [project repository](https://github.com/ashrafjr-n/REJOX) for the full
docs, architecture notes and the web app. This README covers the `rejox` CLI
as distributed on PyPI.

## Install

```bash
uvx rejox migrate ./my-react-app       # try it without installing
pip install rejox                      # or install the CLI
```

**Requirements:** Python 3.11+, and Node 20+ on `PATH` (the deterministic
parser/codemod workers run in Node; `npm` is needed only if you're building
from an sdist rather than a prebuilt wheel).

`pip install rejox` installs the CLI only. The web service (FastAPI, job
queue) is a separate extra:

```bash
pip install "rejox[server]"
```

## Usage

```bash
rejox doctor                     # checks Node 20+, npm and the worker bundles
rejox migrate ./my-react-app
```

```
rejox migrate <project-path> [--out <dir>] [--force] [--yes] [--no-validate] [--json]
```

| Flag | Meaning |
| --- | --- |
| `--out <dir>` | Where to write the React Native project (default: `./<project>-native`). |
| `--force` | Write into `--out` even if it is not empty (files already there are kept). |
| `--yes`, `-y`, `--no-input` | Accept every recommended answer without prompting. Implied when stdin is not a terminal. |
| `--no-validate` | Skip the `tsc` + Metro validation stage (fast). |
| `--json` | Print a machine-readable summary on stdout (progress goes to stderr). Implies `--no-input`. |

`rejox --version` prints the version; `rejox --debug migrate …` shows the full
traceback if Rejox itself fails.

**Exit codes** — stable, for scripts and CI:

| Code | Meaning |
| --- | --- |
| `0` | Migrated; validation passed (or was skipped with `--no-validate`). |
| `1` | Migrated, but validation (`tsc` / Metro) failed. |
| `2` | Usage error (bad flag, missing project, non-empty `--out` without `--force`). |
| `3` | Environment: Node 20+, `npm` or a worker bundle is missing — run `rejox doctor`. |
| `4` | Input refused: the project has no React components to migrate. |
| `70` | Internal error in Rejox; re-run with `--debug` for the traceback. |

## AI is optional

Rejox makes **at most one LLM call** per migration — the navigator *shape*
decision, the one genuine design judgment. Everything else is deterministic.

- `GEMINI_API_KEY=…` → the real provider (Gemini, via `google-genai`) makes
  that one call.
- `REJOX_AI_PROVIDER=fake` → an offline provider makes it deterministically
  (no network), useful for demos and CI.
- Neither set → **AI disabled**: the navigator defaults to a stack and the
  rest of the pipeline is unchanged. Rejox is fully usable with zero AI.

If a build fails validation, a **repair loop** may send the offending line and
its compiler/bundler diagnostic to the LLM (never the whole file), capped at
two rounds. Your source code is never uploaded anywhere except in that one
line-level repair prompt, and only when a `GEMINI_API_KEY` is set.

## Where rejox writes

Nothing is written inside the install directory. Run workspaces and the AI
response cache live in `$XDG_CACHE_HOME/rejox` (`~/.cache/rejox` by default),
overridable with `REJOX_WORKSPACE_ROOT` and `REJOX_AI_CACHE`.

## Platforms

Linux and macOS. Windows is not supported yet.

## License

[FSL-1.1-ALv2](https://github.com/ashrafjr-n/REJOX/blob/master/LICENSE) —
free to use; converts to Apache-2.0 two years after each version's release.
See [`CHANGELOG.md`](CHANGELOG.md) for release history.
