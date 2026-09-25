# Changelog

All notable changes to the `rejox` package are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/) — the version itself comes
from the git tag (`v1.2.3`), never hand-edited in `pyproject.toml`.

## [Unreleased]

### Added

- `rejox` and `rejox-worker` CLI entry points, installable from PyPI via
  `pip install rejox` (CLI only) or `uvx rejox`.
- `rejox[server]` extra for the web service (FastAPI + RQ/Redis job queue).
- `rejox doctor`, `--version`, `--json`, `--no-input`/`--yes`, `--force`, and
  documented exit codes (see `README.md`).
