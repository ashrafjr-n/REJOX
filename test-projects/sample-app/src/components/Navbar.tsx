import { NavLink } from 'react-router-dom'
import CartBadge from './CartBadge'

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/products', label: 'Products', end: false },
  { to: '/settings', label: 'Settings', end: false },
]

/** Top navigation bar with a horizontal flex layout and hover/active states. */
export default function Navbar() {
  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <NavLink to="/" className="text-lg font-bold text-indigo-600">
          Sample&nbsp;Store
        </NavLink>
        <div className="flex items-center gap-1">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-slate-100 ${
                  isActive ? 'text-indigo-600' : 'text-slate-600'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
          <CartBadge />
        </div>
      </nav>
    </header>
  )
}
