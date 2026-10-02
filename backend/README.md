<p align="center">
  <img alt="Rejox — migrate a React web app to React Native: rules first, AI only for the residue" src="https://raw.githubusercontent.com/ashrafjr-n/REJOX/master/docs/assets/readme/hero-light.svg" width="100%">
</p>

# rejox

**React to React Native migration tool.** Rejox resolves by
rules whatever rules can resolve, and invokes AI only where no rule applies —
on the bundled benchmark, **zero LLM calls**, and none at all without a key. It builds a knowledge
graph of a React project, scores its migratability, plans the work, performs
the migration with deterministic AST transforms, checks the output with the
real toolchain (`tsc` + Metro), and hands back a React Native project with
a report of what still needs a human.

See the [project repository](https://github.com/ashrafjr-n/REJOX) for the full
docs, architecture notes and the web app. This README covers the `rejox` CLI
as distributed on PyPI.

## Install

```bash
uvx rejox migrate ./my-react-app       # try it without installing
pip install rejox                      # or install the CLI
```

**Requirements:** Python 3.11+, and Node 20+ with `npm` on `PATH`. The
deterministic parser/codemod workers run in Node; `npm` installs the output to
validate it (`--no-validate` skips that), and builds the workers when you
install from an sdist rather than a prebuilt wheel.

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
| `--json` | Print a machine-readable summary on stdout (progress goes to stderr). On a failure, stdout is still JSON: `{"exitCode", "error"}`. Implies `--no-input`. |

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
| `70` | Internal error in Rejox; re-run with `--debug` for the traceback. A half-written `--out` this run created is removed; an existing one is marked `REJOX-INCOMPLETE.md`. |

## AI is optional

Everything is deterministic except where no rule applies. With a key, the LLM
is asked only these, and sent only what each needs — never a file:

- the navigator *shape* (stack, tabs or drawer): the route table and the nav
  bar's link labels. One call per migration.
- a Tailwind class no rule covers (the class name alone), or a CSS Module
  declaration no rule covers (that one `property: value`). Cached per class.
- if validation fails, the **repair loop**: the offending line and its
  compiler/bundler diagnostic, at most two rounds.

Providers:

- `GEMINI_API_KEY=…` → the real provider (Gemini, via `google-genai`).
- `REJOX_AI_PROVIDER=fake` → an offline provider (no network) for demos and
  CI: it answers the navigator question and declines everything else.
- Neither set → **AI disabled**: the navigator defaults to a stack, anything no
  rule covers stays a `REJOX-TODO`, and the rest is unchanged.

Every call is counted in the summary (`Actual LLM calls`; `llm.calls` in
`--json`).

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
