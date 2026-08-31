import { Outlet } from 'react-router-dom'
import Navbar from './Navbar'
import Footer from './Footer'

interface LayoutProps {
  darkMode: boolean
}

/** App shell: sticky navbar, routed content, footer. */
export default function Layout({ darkMode }: LayoutProps) {
  return (
    <div
      className={`flex min-h-screen flex-col transition-colors ${
        darkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'
      }`}
    >
      <Navbar darkMode={darkMode} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <Footer darkMode={darkMode} />
    </div>
  )
}
