import { useEffect, useRef, useMemo, type ReactNode, type RefObject } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

interface ScrollRevealProps {
  /** Text to reveal. Only string children are split into words; anything else
      renders nothing (the split is word-based and needs plain text). */
  children: ReactNode
  /** Optional custom scroller; falls back to the window. */
  scrollContainerRef?: RefObject<HTMLElement | null>
  enableBlur?: boolean
  baseOpacity?: number
  baseRotation?: number
  blurStrength?: number
  containerClassName?: string
  textClassName?: string
  /** Entrance scrub range — words rise/fade/blur in from the bottom. Both
      anchors use the element's TOP so the scrub distance is independent of the
      element's own height: a one-line headline and a multi-line paragraph get
      the SAME gradual, non-instant reveal. (The previous `bottom bottom` end
      collapsed the range to ~0 for a single line, which is why the headline
      snapped in instantly.) */
  revealStart?: string
  revealEnd?: string
  /** Top-exit — mirrors the entrance for scrolling away: as the element scrolls
      up to ~20vh from the top, it fades/blurs/rotates out toward the top. */
  enableExit?: boolean
  exitStart?: string
  exitEnd?: string
  /** Per-word stagger (seconds); larger = a more deliberate word-by-word
      cascade across the scroll range. */
  stagger?: number
}

const ScrollReveal = ({
  children,
  scrollContainerRef,
  enableBlur = true,
  baseOpacity = 0,
  baseRotation = 3,
  blurStrength = 4,
  containerClassName = '',
  textClassName = '',
  revealStart = 'top bottom',
  revealEnd = 'top center',
  enableExit = true,
  exitStart = 'top 20%',
  exitEnd = '+=50%',
  stagger = 0.08,
}: ScrollRevealProps) => {
  const containerRef = useRef<HTMLHeadingElement | null>(null)

  const splitText = useMemo<ReactNode[]>(() => {
    const text = typeof children === 'string' ? children : ''
    return text.split(/(\s+)/).map((word, index) => {
      if (word.match(/^\s+$/)) return word
      return (
        <span className="inline-block word" key={index}>
          {word}
        </span>
      )
    })
  }, [children])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const scroller: HTMLElement | Window =
      scrollContainerRef && scrollContainerRef.current
        ? scrollContainerRef.current
        : window

    const wordElements = el.querySelectorAll<HTMLSpanElement>('.word')

    // ---- ENTRANCE: rise / fade / blur in from the bottom (unchanged in feel,
    //      just scrubbed over a longer, height-independent distance). ----
    const revealTrigger = { trigger: el, scroller, start: revealStart, end: revealEnd, scrub: true }
    gsap.fromTo(
      el,
      { transformOrigin: '0% 50%', rotate: baseRotation },
      { ease: 'none', rotate: 0, scrollTrigger: revealTrigger }
    )
    gsap.fromTo(
      wordElements,
      { opacity: baseOpacity },
      { ease: 'none', opacity: 1, stagger, scrollTrigger: revealTrigger }
    )
    if (enableBlur) {
      gsap.fromTo(
        wordElements,
        { filter: `blur(${blurStrength}px)` },
        { ease: 'none', filter: 'blur(0px)', stagger, scrollTrigger: revealTrigger }
      )
    }

    // ---- TOP-EXIT: once the element scrolls up to ~20vh from the top, animate
    //      it back out toward the top (fade + blur + rotate away). Uses `.to()`
    //      with immediateRender:false so it records the fully-revealed state as
    //      its start and never fights the entrance in the visible/hold zone. ----
    if (enableExit) {
      const exitTrigger = { trigger: el, scroller, start: exitStart, end: exitEnd, scrub: true }
      gsap.to(el, {
        ease: 'none',
        rotate: -baseRotation,
        immediateRender: false,
        scrollTrigger: exitTrigger,
      })
      gsap.to(wordElements, {
        ease: 'none',
        opacity: baseOpacity,
        stagger,
        immediateRender: false,
        scrollTrigger: exitTrigger,
      })
      if (enableBlur) {
        gsap.to(wordElements, {
          ease: 'none',
          filter: `blur(${blurStrength}px)`,
          stagger,
          immediateRender: false,
          scrollTrigger: exitTrigger,
        })
      }
    }

    return () => {
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill())
    }
  }, [
    scrollContainerRef,
    enableBlur,
    baseRotation,
    baseOpacity,
    blurStrength,
    revealStart,
    revealEnd,
    enableExit,
    exitStart,
    exitEnd,
    stagger,
  ])

  return (
    <h2 ref={containerRef} className={`my-5 ${containerClassName}`}>
      <p
        className={`text-[clamp(1.6rem,4vw,3rem)] leading-[1.5] font-semibold ${textClassName}`}
      >
        {splitText}
      </p>
    </h2>
  )
}

export default ScrollReveal
