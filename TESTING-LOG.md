# Testing log

Real React projects run through Rejox, one short entry each. It exists so a
later session — or a different Claude session — picks up the context without
re-discovering the same things.

**Deliberately terse: 4–5 lines per project, maximum.** What a run found, what
got fixed, and anything a future project needs to know. Nothing more — the
commits hold the detail, and [`docs/CONVERSION-RULES.md`](docs/CONVERSION-RULES.md)
holds the rules. Two uneventful projects in a row get one line, not two entries.

---

## 2026-09-05 — `adrianhajdin/project_ai_summarizer` (re-test, on device)

Second pass on the same project — first one to actually reach an iOS Simulator.

- **Found:** the app builds, bundles and launches, then dies on
  `localStorage` — the storage question was asked, answered, and the answer
  thrown away. The deeper find is WHY nothing caught it: the Validator cannot
  see browser APIs at all (see Known gaps), so this was never one missing rule.
- **Fixed:** the `storage` answer is applied — AsyncStorage (awaited, with the
  await placement decided from the enclosing function, never assumed) or MMKV
  (synchronous, a pure rename); packages Rejox introduces itself are now pinned,
  since carry-over can only supply what the uploaded project declared.
- **For future projects:** a device run is worth more than both gates on this
  class of bug. If an app builds and bundles and still dies on launch, suspect
  a web global before suspecting the transform.

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
- **The Knowledge Graph only sees browser APIs inside components.**
  `extractComponents` requires a PascalCase name AND JSX, so a hook, service or
  util file (`hooks/useLocalStorage.js`) contributes no `webApis` at all — the
  Report never mentions them and the Ask stage may not even raise the storage
  question, while the transformer converts those files anyway. The emitted code
  still carries the TODO; only the report is silent. Not urgent.
- **The Validator is blind to browser APIs.** `expo/tsconfig.base` sets
  `lib: ["DOM", "ESNext"]`, so `localStorage`/`window`/`navigator`/`document`
  type-check, and Metro bundles them as valid JS — tsc + Metro can never fail
  on one. Measured on the 11-project benchmark: **31 real occurrences across 6
  projects**, all invisible to the gates. A green run says nothing about this
  class. Dropping the DOM lib is NOT the fix — it also errors on 66 globals RN
  really does provide (`setTimeout` alone is 48); measured and rejected, see
  the guard section in `docs/CONVERSION-RULES.md`. **Half-closed:** the
  transformer now flags the closed list (`document`/`window`/`navigator`/
  `history`/`location`/`alert`, plus storage under its own rule) as
  `WEB_GLOBAL` — measured at 20 `WEB_GLOBAL` + 21 storage sites across 6 of the
  11 projects, with zero false alarms. The gates themselves are still blind — a `WEB_GLOBAL` TODO
  lowers the score but nothing FAILS a run, so a project can still ship green
  with one. Anything else in this family has the same root, not a new
  discovery.
- **The Analyzer does not predict `import.meta.env`.** The transformer rewrites
  it, but the Report/Ask stage never mentions the project has build-time env at
  all, so the migrated app's missing `EXPO_PUBLIC_*` keys are a surprise.
