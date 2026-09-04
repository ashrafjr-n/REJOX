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

- **Found:** any router-less project lost its whole UI — `src/App.jsx` was never
  converted, just replaced by a placeholder, so every converted component was
  emitted but unreachable, and `main.jsx`'s `<Provider>` vanished with the file.
  Metro still reported **PASS**, because the stub made everything unreachable.
- **Fixed:** the root component is now converted when no navigator subsumes it,
  and the entry file's provider chain is lifted into `App.tsx`.
- **For future projects:** a green Metro means nothing until the entry actually
  reaches the converted files — check reachability before trusting the score.
  Still open here: emitted code's deps get dropped (Redux is wrongly labelled
  unsupported), the global-CSS `@apply` layer is lost, and the storage question
  is asked but never applied.

### Re-test, same day — after the fixes

Root component and providers held. With the UI finally reachable, three numbers
turned out to be lying: carry-over shipped `react-redux` but not
`@reduxjs/toolkit` (Metro dead on the first module), "compiles + bundles" rose
33%→43% while Metro went PASS→FAIL, and "0 unmappable" was counting 13 of the
project's own CSS classes as Tailwind. All four fixed. `import.meta.env` is now
the only Metro blocker left — and that was three bugs in a row from a fixed list
rather than from what the project actually shows.
