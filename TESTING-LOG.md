# Testing log

Real React projects run through Rejox, one short entry each. It exists so a
later session — or a different Claude session — picks up the context without
re-discovering the same things.

**Deliberately terse: 4–5 lines per project, maximum.** What a run found, what
got fixed, and anything a future project needs to know. Nothing more — the
commits hold the detail, and [`docs/CONVERSION-RULES.md`](docs/CONVERSION-RULES.md)
holds the rules. Two uneventful projects in a row get one line, not two entries.

---

## 2026-09-04 — `adrianhajdin/project_ai_summarizer`

Vite + plain JS + Redux Toolkit / RTK Query, **no router**.

- **Found:** a router-less project lost its whole UI — `src/App.jsx` was replaced
  by a placeholder and `main.jsx`'s `<Provider>` vanished with the file, while
  Metro still reported PASS because nothing was reachable to fail.
- **Fixed:** the root component is converted when no navigator subsumes it, and
  the provider chain is lifted; a re-test the same day then caught three more
  numbers lying about the same run (carry-over, the compiles + bundles lens,
  "0 unmappable"), all fixed, plus `import.meta.env`.
- **For future projects:** a green Metro means nothing until the entry actually
  reaches the converted files — check reachability before trusting a score.

---

## Known gaps

Open across projects. Here so no entry has to repeat them, and so a run that
hits one recognises it instead of rediscovering it.

- **Global CSS is not carried over.** A stylesheet's own classes (usually
  `@apply`) are counted unmappable and named in the report; the design is lost.
- **`CUSTOM_CSS_CLASS` deducts from the components area, not styling** — the
  "Styling surface" row can still read "maps 1:1" while classes go unmapped.
- **The storage question is asked but never applied** (`localStorage` →
  AsyncStorage is decided and then not acted on).
- **The Analyzer does not predict `import.meta.env`.** The transformer rewrites
  it, but the Report/Ask stage never mentions the project has build-time env at
  all, so the migrated app's missing `EXPO_PUBLIC_*` keys are a surprise.
