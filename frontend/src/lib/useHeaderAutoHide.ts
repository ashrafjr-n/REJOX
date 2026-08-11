import { useEffect, useState } from 'react'

/**
 * Header auto-hide: while the first viewport is on screen the header is always
 * visible; once scrolled past it, scrolling DOWN hides it (chrome getting out
 * of the way) and scrolling UP by any meaningful amount brings it straight
 * back — the user never has to return to the top. A small threshold swallows
 * trackpad jitter/momentum so the state never flickers.
 *
 * It reads window.scrollY only (the header is position:fixed, so no ancestor
 * transform can move it): direction detection works identically in normal flow
 * and while a pinned section is active. The actual hide/show transition (or the
 * reduced-motion snap) is CSS.
 *
 * Lifted out of SiteHeader so /app's step-indicator bar — which has to sit
 * directly below the capsule — can follow the same state instead of guessing.
 */
export function useHeaderAutoHide(): boolean {
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
      // While the first viewport is still on screen, keep the header.
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
