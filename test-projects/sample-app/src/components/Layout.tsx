import { Outlet } from 'react-router-dom'
import Navbar from './Navbar'
import Footer from './Footer'

/** App shell: sticky navbar, routed content, footer. */
export default function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <Navbar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
