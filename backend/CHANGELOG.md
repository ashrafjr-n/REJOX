# Changelog

All notable changes to the `rejox` package are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/) — the version itself comes
from the git tag (`v1.2.3`), never hand-edited in `pyproject.toml`.

## [Unreleased]

### Fixed

- A migration with no `GEMINI_API_KEY` no longer crashes (exit 70) on a
  Tailwind class no rule covers: the class is kept and flagged as
  `TW_UNSUPPORTED`, as the zero-AI promise says.
- LLM calls made while resolving styling residue are now counted in
  "Actual LLM calls" and `--json`; they used to go to a provider the summary
  never saw.
- Nothing is removed silently any more. A class removed because React Native
  needs a different structure (a gradient, `backdrop-blur`, `animate-spin`,
  `divide-*`, `sticky`/`fixed`, a CSS grid's child widths), and a CSS Module
  declaration or `:hover` rule the StyleSheet could not carry, now leaves a
  `TW_STRUCTURAL` / `CSS_STRUCTURAL` TODO with the React Native code to write.
  Such files no longer count as fully migrated: the benchmark's strict
  coverage is **42%**, not the 62% previously reported.
- The residue tier breakdown shows what the emit step actually did, including
  classes left unresolved, instead of re-running the resolvers afterwards.

## [0.1.1] - 2026-09-26

### Added

- Python 3.14 support, tested in CI on Linux and macOS.

### Fixed

- Intel Macs no longer compile `cryptography` from source (it needed a Rust
  toolchain): it is capped below 49, the last line that ships macOS x86_64
  wheels, on that platform only.

## [0.1.0] - 2026-09-26

### Added

- `rejox` and `rejox-worker` CLI entry points, installable from PyPI via
  `pip install rejox` (CLI only) or `uvx rejox`.
- `rejox[server]` extra for the web service (FastAPI + RQ/Redis job queue).
- `rejox doctor`, `--version`, `--json`, `--no-input`/`--yes`, `--force`, and
  documented exit codes (see `README.md`).

[Unreleased]: https://github.com/ashrafjr-n/REJOX/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/ashrafjr-n/REJOX/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ashrafjr-n/REJOX/releases/tag/v0.1.0
