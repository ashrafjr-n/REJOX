# broken-app — a deliberately unmigratable fixture

This is not a sample of what Rejox migrates. It is the fixture gate **E0** in
[`docs/PRE-LAUNCH-CHECKLIST.md`](../../docs/PRE-LAUNCH-CHECKLIST.md) uses to ask
whether a *failed* migration can be diagnosed afterwards from what a deployment
retains.

It looks like a React project from the outside — `react` and `react-dom` in
`package.json`, a Vite config with the React plugin, an `index.html` mounting
`#root`, a `tsconfig` with `"jsx": "react-jsx"` — and it contains no React
component at all. Every module under `src/` is plain TypeScript.

That is the shape of a real upload that fails: someone zips the repository root
of a monorepo, or a wrapper directory, and the components are in a package that
never made it into the archive. The pipeline reaches the analyze stage, finds no
components, and refuses with `NothingToMigrate` rather than scoring an empty
graph — see the empty-population rule in `docs/ARCHITECTURE.md`.

**Do not "fix" this project.** Adding a component to it silently disables the
gate that depends on it (`backend/tests/test_broken_fixture.py` fails if that
happens).
