/**
 * The pipeline's motion vocabulary — one system, shared by every step.
 *
 * The easing is the home page's house curve, `cubic-bezier(0.22, 1, 0.36, 1)`
 * (see Home.css / SiteHeader / Architecture / Docs). Before this module each
 * screen invented its own timing (0.2 / 0.25 / 0.28 / 0.3 / 0.4 with three
 * different eases), which is exactly what made the flow read as six screens
 * built in six sessions.
 *
 * Three durations, one stagger. If something needs a fourth, it probably wants
 * one of these instead.
 */

/** The house easing, as a framer-motion cubic-bezier tuple. */
export const HOUSE_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]

export const DUR = {
  /** Things leaving, collapsing, or getting out of the way. */
  exit: 0.18,
  /** The default: anything arriving on screen. */
  enter: 0.3,
  /** A bar or number settling into place after its row has arrived. */
  settle: 0.42,
} as const

/** Delay between staggered siblings. Halved for long cascades (>10 rows). */
export const STAGGER = 0.06
export const STAGGER_FINE = 0.03

/** The standard "arrive" transition. */
export const enter = (delay = 0) => ({
  duration: DUR.enter,
  ease: HOUSE_EASE,
  delay,
})

/**
 * Standard arrival props for a staggered list row, reduced-motion aware:
 * no offset, no stagger, no transition when the user asked for less motion.
 */
export function rowEntry(index: number, reduceMotion: boolean, step = STAGGER) {
  if (reduceMotion) {
    return { initial: false as const, animate: { opacity: 1, y: 0 } }
  }
  return {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: enter(index * step),
  }
}
