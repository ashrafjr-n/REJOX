/**
 * Placeholder landing page for the Rejox AI web app.
 * Renders the product name and confirms the Tailwind pipeline is wired up.
 */
export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 text-slate-100">
      <h1 className="bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-6xl font-bold tracking-tight text-transparent">
        Rejox AI
      </h1>
      <p className="text-lg text-slate-400">
        AI migration engineer — React → React Native
      </p>
      <span className="rounded-full bg-emerald-500/10 px-4 py-1 text-sm font-medium text-emerald-400 ring-1 ring-emerald-500/30">
        ✓ Tailwind is working
      </span>
    </main>
  )
}
