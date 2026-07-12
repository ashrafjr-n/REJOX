# Rejox AI — Product Requirements (MVP)

## Vision

Rejox AI acts as an automated migration engineer. Given a React web project, it
produces a working React Native project, along with a transparent report of what
was converted, what needs human attention, and why.

## MVP scope

The MVP does **one thing**: convert **React (web) → React Native**. Nothing else.
Direction is one-way. Breadth is intentionally narrow so conversion quality stays high.

### Supported in MVP

| Area              | Supported                                                    |
| ----------------- | ----------------------------------------------------------- |
| Components        | Functional components                                       |
| State / logic     | React hooks (`useState`, `useEffect`, custom hooks, etc.)   |
| Routing           | React Router (`react-router-dom`) → React Navigation        |
| Data fetching     | Axios, `fetch`                                               |
| Styling           | CSS Modules, Tailwind (via NativeWind)                       |

### Explicitly NOT supported in MVP

These are out of scope. If a project depends on any of them, Rejox flags it during
the **Analysis / Ask** stages rather than attempting a conversion:

- Redux (and other external state managers)
- Three.js / WebGL
- Canvas / `<canvas>` rendering
- Electron
- Server-Side Rendering (SSR)
- Next.js
- React Native → Web (reverse direction)

## Non-goals (MVP)

- Pixel-perfect visual parity — layout intent is preserved, not exact pixels.
- Automatic handling of native modules requiring bespoke setup.
- Multi-framework input (Vue, Svelte, Angular, etc.).

## Success criteria

- The benchmark app in `test-projects/sample-app/` converts to a project that
  passes `tsc` and boots under Metro.
- Every unsupported pattern encountered is reported, never silently dropped.
- A human can read the migration report and understand every decision made.

## Primary user flow

Upload → Analysis → Report → Plan → Ask → Migrate → Review → Download.
(See [`../CLAUDE.md`](../CLAUDE.md) for the canonical stage list.)
