import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Link, useLocation } from 'react-router-dom'
import { gsap } from 'gsap'
import { ScrollToPlugin } from 'gsap/ScrollToPlugin'
import { CustomEase } from 'gsap/CustomEase'

// The header's styling (the `.rx-header` / `.rx-nav` / `.rx-logo` rules) and the
// `--rx-*` design tokens both live in Home.css. Importing it here — rather than
// duplicating those rules — is what lets a second page (e.g. /architecture) wear
// the exact same chrome by rendering <SiteHeader/>, with nothing moved out of
// Home.css (so the home page's own styling is untouched).
import '../screens/Home.css'
import rejoxLogo from '../assets/rejox-logo.svg'

gsap.registerPlugin(ScrollToPlugin, CustomEase)

// The page's house easing — the same cubic-bezier(0.22, 1, 0.36, 1) the hero
// entrances and header transitions use — so the logo's scroll-to-top speaks the
// same motion language as the rest of the page. Registered under its own name so
// it never collides with the Scene 02 module's 'rxHouse'.
const HOME_HOUSE_EASE = CustomEase.create('rxHomeHouse', 'M0,0 C0.22,1 0.36,1 1,1')

// Nav items. `to` is the route a real link points at; `null` marks a
// not-yet-built placeholder (kept a non-functional button, exactly as it was).
const NAV_ITEMS: { label: string; to: string | null }[] = [
  { label: 'Home', to: '/' },
  { label: 'Architecture', to: '/architecture' },
  { label: 'Docs', to: null },
]

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Header auto-hide: while the hero fills the viewport the header is always
 * visible; once scrolled past the hero, scrolling DOWN hides it (chrome getting
 * out of the way) and scrolling UP by any meaningful amount brings it straight
 * back — the user never has to return to the top. A small threshold swallows
 * trackpad jitter/momentum so the state never flickers.
 *
 * It reads window.scrollY only (the header is position:fixed, a sibling of the
 * pinned Scene 01, so the pin's spacer/transform never moves it): direction
 * detection works identically in normal flow and while the pinned section is
 * active. The actual hide/show transition (or the reduced-motion snap) is CSS.
 */
function useHeaderAutoHide(): boolean {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    // Movement (in px) required before the header commits to a new state — large
    // enough that jitter and momentum tails don't toggle it, small enough that a
    // deliberate flick reveals it immediately.
    const THRESHOLD = 8
    let lastY = window.scrollY
    let ticking = false

    const update = () => {
      ticking = false
      const y = window.scrollY
      // Hero is one viewport tall; while it is still on screen keep the header.
      const heroInView = y <= window.innerHeight
      if (heroInView) {
        lastY = y
        setHidden(false)
        return
      }
      const delta = y - lastY
      if (Math.abs(delta) < THRESHOLD) return // within jitter band — accumulate
      setHidden(delta > 0) // scrolling down hides; up reveals
      lastY = y
    }

    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(update)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return hidden
}

/**
 * The floating capsule header shared by every marketing page: logo, primary nav,
 * and the Login pill, fixed to the viewport with the hero-past auto-hide.
 *
 * The nav is route-aware. On `/` the logo smooth-scrolls back to the hero (its
 * long-standing behaviour); on any other page it is a real link home. The nav
 * items that have a route are real links, with the current page wearing the
 * `is-active` treatment; Docs has no page yet, so it stays a non-functional
 * placeholder button — no route, no handler.
 */
export function SiteHeader() {
  const headerHidden = useHeaderAutoHide()
  const { pathname } = useLocation()
  const onHome = pathname === '/'

  // Logo → back to the hero, but only when we are already on the home page.
  // Smooth, house-eased scroll that matches the page's motion language;
  // reduced-motion jumps instead of animating.
  const handleLogoClick = () => {
    if (prefersReducedMotion()) {
      window.scrollTo({ top: 0 }) // jump, no animation
      return
    }
    gsap.to(window, { duration: 0.9, ease: HOME_HOUSE_EASE, scrollTo: { y: 0 } })
  }

  const logoImg = <img className="rx-logo" src={rejoxLogo} alt="" />

  return (
    <motion.header
      className={'rx-header' + (headerHidden ? ' is-hidden' : '')}
      data-hidden={headerHidden ? 'true' : 'false'}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Logo is a real interactive control (keyboard-focusable, labelled). On
          the home page it returns to the hero via a smooth scroll (transparent
          to layout/paint, so it looks and sits exactly as before); on other
          pages it is a plain link back home. */}
      {onHome ? (
        <button
          type="button"
          className="rx-logo-btn"
          onClick={handleLogoClick}
          aria-label="Rejox — back to top"
        >
          {logoImg}
        </button>
      ) : (
        <Link className="rx-logo-btn" to="/" aria-label="Rejox — home">
          {logoImg}
        </Link>
      )}

      <nav className="rx-nav" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const active = item.to !== null && pathname === item.to
          const className = 'rx-nav-item ' + (active ? 'is-active' : 'is-inactive')
          // Placeholder (no route yet) → a non-functional button, unchanged.
          if (item.to === null) {
            return (
              <button key={item.label} type="button" className={className}>
                {item.label}
              </button>
            )
          }
          // Real link; the current page carries aria-current + the active look.
          return (
            <Link
              key={item.label}
              to={item.to}
              className={className}
              aria-current={active ? 'page' : undefined}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>

      <button type="button" className="rx-cta-pill">
        Login
      </button>
    </motion.header>
  )
}
