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
  coverage is **38%**, not the 62% previously reported (42% from this
  change, and 38% once the navigator's missing `<Navbar>`/`<Footer>` is
  flagged too — see `NAV_CHROME` below).
- The residue tier breakdown shows what the emit step actually did, including
  classes left unresolved, instead of re-running the resolvers afterwards.
- `onChange={(e) => set(e.target.value)}` came out as an `onChangeText`
  handler still reading `e.target` — a tsc error in the most common input
  pattern. A handler that only reads the value now takes the string (inline or
  named); one that reads more keeps its `EVENT_ADAPTER` TODO.
- `useNavigate()` lost its import and kept its calls, so the file no longer
  compiled. It now becomes `useNavigation()`: route-table paths navigate to
  their screen, `navigate(-1)` goes back, and a runtime path stays a
  compiling `navigation.navigate(…)` call with a `NAV_HOOK` TODO.
- `<a href>` became `<Pressable href>` (a tsc error). An absolute URL now opens
  with `Linking.openURL`, a routed path navigates, and anything else is flagged
  as `ANCHOR_LINK` — `href` never survives.
- A space between two elements (`<strong>bold</strong> text`) reached a
  `<View>` as a bare string, which React Native throws on at runtime while tsc
  and Metro pass. Inline runs are now one `<Text>`, and stray spaces are gone.
- `<Link>` around a `<Button>` produced a Pressable inside a Pressable, whose
  navigation never fired (the benchmark's "Shop products"). The button now
  takes the `onPress` itself.
- UI rendered around the routes — a nav bar, a header, the benchmark's
  `<Navbar>` and `<Footer>` — was replaced by the navigator and rendered
  nowhere, silently. `AppNavigator.tsx` now carries a `NAV_CHROME` TODO naming it.
- `peer-*` and `columns-*` classes, which NativeWind drops silently, are
  flagged as `TW_UNSUPPORTED`.
- A green tsc + Metro run said nothing about `<table>`, `document` or an
  untouched `localStorage` — all of which type-check, bundle and throw on the
  device. They are now listed as "runtime risks" next to the validation result,
  in the summary, and in `--json` (`runtimeRisks`).
- "Remaining diagnostics (all map to known residue)" was printed, never
  checked. The CLI now counts how many errors fall in files with a REJOX-TODO,
  and calls an error in a file with none what it is: a Rejox bug.
- The TODO count disagreed with itself (13 in the summary, 15 in the report,
  19 in a file's own banner). Every place now counts items the way the banner
  does, the summary table lists every flagged code, and a truncated table says
  how many it left out.
- `REJOX-REPORT.md` no longer says the AI engine "will resolve" the TODOs (no
  later step does), and counts files with any TODO, not only those with residue.
- An unused cache reads `n/a`, not `0%`.
- With a `GEMINI_API_KEY` whose provider fails to start, the CLI said "no
  GEMINI_API_KEY"; it now gives the real reason.
- The offline `fake` provider answered unknown prompts with a placeholder that
  parsed as a className, so a fake-mode run could write `FAKE_RESPONSE[…]` into
  the app. It now declines (`UNRESOLVABLE`), and the class stays residue.
- `--json` printed nothing on stdout when the run failed (a usage error, a
  missing tool, an internal error). It now prints `{"exitCode", "error"}`, so
  a script reading stdout always gets JSON.
- An internal error part-way through writing the project left a half-written
  `--out` that looked complete. A directory the run created is now removed; one
  that already existed (`--force`) is never deleted, and gets a
  `REJOX-INCOMPLETE.md` instead.
- A source file the codemod could not convert was only a "skipped" count; the
  CLI now names it as missing from the output, and its reason no longer breaks
  the `REJOX-REPORT.md` list.
- A source file with syntax errors is said to have them (`SOURCE_SYNTAX`): the
  compiler's recovery can be valid code, so nothing else could tell.
- The Ask stage offered choices the emitter never implemented: "Bare React
  Native" produced the same Expo project; "RN StyleSheet" kept every
  `className` with no NativeWind, so all styling was lost on the device; "Expo
  Router" failed Metro around a placeholder `app/`; the icons question was read
  by nothing. Only implemented options are offered now (Expo, NativeWind, React
  Navigation; AsyncStorage or MMKV), a one-option question is stated rather than
  asked, and `emit_project` refuses an answer the plan did not offer — so an API
  client cannot request one of them either. Icon libraries are reported as
  `needs-conversion` with their React Native counterpart, not as `unknown`.

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
