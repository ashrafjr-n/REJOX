interface FooterProps {
  darkMode: boolean
}

/** Page footer. */
export default function Footer({ darkMode }: FooterProps) {
  return (
    <footer
      className={`border-t ${
        darkMode ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
      }`}
    >
      <div
        className={`mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm sm:flex-row ${
          darkMode ? 'text-slate-400' : 'text-slate-500'
        }`}
      >
        <span>© 2026 Sample Store — a Rejox migration benchmark.</span>
        <span>Built with React + Vite</span>
      </div>
    </footer>
  )
}
