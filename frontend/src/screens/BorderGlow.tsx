import {
  useRef,
  useCallback,
  useState,
  useEffect,
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react'

/**
 * BorderGlow — a faithful TypeScript port of the reference `BorderGlow.jsx`.
 *
 * The visual mechanics are preserved exactly, not reinterpreted:
 *   • the pointer's *angle* around the card centre (`cursorAngle`, via atan2)
 *     drives conic-gradient masks on the border / fill / glow layers;
 *   • `edgeProximity` (0 at centre → 1 at the border) gates border and glow
 *     opacity through the `edgeSensitivity` thresholds, so colour only lights up
 *     as the cursor approaches an edge;
 *   • the background is a 7-stop mesh gradient built from `colors[]` via
 *     GRADIENT_POSITIONS / COLOR_MAP, painted twice (border-box for the border
 *     ring, padding-box for the near-edge fill);
 *   • the outer glow is a 13-layer box-shadow built from an HSL `glowColor`,
 *     conic-masked so it only blooms on the cursor's side.
 *
 * The single addition on top of the port is the glassmorphism requirement:
 * `backdropBlur` (px) turns the card into frosted glass so the hero LightPillar
 * shows through behind a translucent `backgroundColor`. It defaults to 0 (off),
 * so the component's original opaque behaviour is unchanged unless requested.
 */

interface HSL {
  h: number
  s: number
  l: number
}

function parseHSL(hslStr: string): HSL {
  const match = hslStr.match(/([\d.]+)\s*([\d.]+)%?\s*([\d.]+)%?/)
  if (!match) return { h: 40, s: 80, l: 80 }
  return { h: parseFloat(match[1]), s: parseFloat(match[2]), l: parseFloat(match[3]) }
}

// [x, y, blur, spread, alpha, inset]
type ShadowLayer = [number, number, number, number, number, boolean]

function buildBoxShadow(glowColor: string, intensity: number): string {
  const { h, s, l } = parseHSL(glowColor)
  const base = `${h}deg ${s}% ${l}%`
  const layers: ShadowLayer[] = [
    [0, 0, 0, 1, 100, true],
    [0, 0, 1, 0, 60, true],
    [0, 0, 3, 0, 50, true],
    [0, 0, 6, 0, 40, true],
    [0, 0, 15, 0, 30, true],
    [0, 0, 25, 2, 20, true],
    [0, 0, 50, 2, 10, true],
    [0, 0, 1, 0, 60, false],
    [0, 0, 3, 0, 50, false],
    [0, 0, 6, 0, 40, false],
    [0, 0, 15, 0, 30, false],
    [0, 0, 25, 2, 20, false],
    [0, 0, 50, 2, 10, false],
  ]
  return layers
    .map(([x, y, blur, spread, alpha, inset]) => {
      const a = Math.min(alpha * intensity, 100)
      return `${inset ? 'inset ' : ''}${x}px ${y}px ${blur}px ${spread}px hsl(${base} / ${a}%)`
    })
    .join(', ')
}

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3)
}
function easeInCubic(x: number): number {
  return x * x * x
}

interface AnimateValueOptions {
  start?: number
  end?: number
  duration?: number
  delay?: number
  ease?: (x: number) => number
  onUpdate: (value: number) => void
  onEnd?: () => void
}

function animateValue({
  start = 0,
  end = 100,
  duration = 1000,
  delay = 0,
  ease = easeOutCubic,
  onUpdate,
  onEnd,
}: AnimateValueOptions): void {
  const t0 = performance.now() + delay
  function tick() {
    const elapsed = performance.now() - t0
    const t = Math.min(elapsed / duration, 1)
    onUpdate(start + (end - start) * ease(t))
    if (t < 1) requestAnimationFrame(tick)
    else if (onEnd) onEnd()
  }
  setTimeout(() => requestAnimationFrame(tick), delay)
}

const GRADIENT_POSITIONS: string[] = [
  '80% 55%',
  '69% 34%',
  '8% 6%',
  '41% 38%',
  '86% 85%',
  '82% 18%',
  '51% 4%',
]
const COLOR_MAP: number[] = [0, 1, 2, 0, 1, 2, 1]

function buildMeshGradients(colors: string[]): string[] {
  const gradients: string[] = []
  for (let i = 0; i < 7; i++) {
    const c = colors[Math.min(COLOR_MAP[i], colors.length - 1)]
    gradients.push(`radial-gradient(at ${GRADIENT_POSITIONS[i]}, ${c} 0px, transparent 50%)`)
  }
  gradients.push(`linear-gradient(${colors[0]} 0 100%)`)
  return gradients
}

export interface BorderGlowProps {
  children?: ReactNode
  className?: string
  edgeSensitivity?: number
  /** HSL triplet string, e.g. '40 80 80' (h s l) — parsed for the glow shadow. */
  glowColor?: string
  backgroundColor?: string
  borderRadius?: number
  glowRadius?: number
  glowIntensity?: number
  coneSpread?: number
  animated?: boolean
  colors?: string[]
  fillOpacity?: number
  /** Glassmorphism extension (not in the original): px blur for backdrop-filter. 0 = off. */
  backdropBlur?: number
}

function BorderGlow({
  children,
  className = '',
  edgeSensitivity = 30,
  glowColor = '40 80 80',
  backgroundColor = '#120F17',
  borderRadius = 28,
  glowRadius = 40,
  glowIntensity = 1.0,
  coneSpread = 25,
  animated = false,
  colors = ['#c084fc', '#f472b6', '#38bdf8'],
  // `fillOpacity` stays in BorderGlowProps for API/back-compat (callers may still
  // pass it) but is intentionally NOT destructured/used: the "fill near edges"
  // layer it drove has been removed entirely (see note by the border layer).
  backdropBlur = 0,
}: BorderGlowProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [cursorAngle, setCursorAngle] = useState(45)
  const [edgeProximity, setEdgeProximity] = useState(0)
  const [sweepActive, setSweepActive] = useState(false)

  const getCenterOfElement = useCallback((el: HTMLElement): [number, number] => {
    const { width, height } = el.getBoundingClientRect()
    return [width / 2, height / 2]
  }, [])

  const getEdgeProximity = useCallback(
    (el: HTMLElement, x: number, y: number): number => {
      const [cx, cy] = getCenterOfElement(el)
      const dx = x - cx
      const dy = y - cy
      let kx = Infinity
      let ky = Infinity
      if (dx !== 0) kx = cx / Math.abs(dx)
      if (dy !== 0) ky = cy / Math.abs(dy)
      return Math.min(Math.max(1 / Math.min(kx, ky), 0), 1)
    },
    [getCenterOfElement],
  )

  const getCursorAngle = useCallback(
    (el: HTMLElement, x: number, y: number): number => {
      const [cx, cy] = getCenterOfElement(el)
      const dx = x - cx
      const dy = y - cy
      if (dx === 0 && dy === 0) return 0
      const radians = Math.atan2(dy, dx)
      let degrees = radians * (180 / Math.PI) + 90
      if (degrees < 0) degrees += 360
      return degrees
    },
    [getCenterOfElement],
  )

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const card = cardRef.current
      if (!card) return
      const rect = card.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      setEdgeProximity(getEdgeProximity(card, x, y))
      setCursorAngle(getCursorAngle(card, x, y))
    },
    [getEdgeProximity, getCursorAngle],
  )

  useEffect(() => {
    if (!animated) return
    const angleStart = 110
    const angleEnd = 465
    setSweepActive(true)
    setCursorAngle(angleStart)

    animateValue({ duration: 500, onUpdate: (v) => setEdgeProximity(v / 100) })
    animateValue({
      ease: easeInCubic,
      duration: 1500,
      end: 50,
      onUpdate: (v) => {
        setCursorAngle((angleEnd - angleStart) * (v / 100) + angleStart)
      },
    })
    animateValue({
      ease: easeOutCubic,
      delay: 1500,
      duration: 2250,
      start: 50,
      end: 100,
      onUpdate: (v) => {
        setCursorAngle((angleEnd - angleStart) * (v / 100) + angleStart)
      },
    })
    animateValue({
      ease: easeInCubic,
      delay: 2500,
      duration: 1500,
      start: 100,
      end: 0,
      onUpdate: (v) => setEdgeProximity(v / 100),
      onEnd: () => setSweepActive(false),
    })
  }, [animated])

  const colorSensitivity = edgeSensitivity + 20
  const isVisible = isHovered || sweepActive
  const borderOpacity = isVisible
    ? Math.max(0, (edgeProximity * 100 - colorSensitivity) / (100 - colorSensitivity))
    : 0
  const glowOpacity = isVisible
    ? Math.max(0, (edgeProximity * 100 - edgeSensitivity) / (100 - edgeSensitivity))
    : 0

  const meshGradients = buildMeshGradients(colors)
  const borderBg = meshGradients.map((g) => `${g} border-box`)
  const angleDeg = `${cursorAngle.toFixed(3)}deg`

  // Root style — glass extension layered on the port: translucent background +
  // backdrop blur when backdropBlur > 0, otherwise the original opaque look.
  const rootStyle: CSSProperties = {
    background: backgroundColor,
    borderRadius: `${borderRadius}px`,
    transform: 'translate3d(0, 0, 0.01px)',
    boxShadow:
      'rgba(0,0,0,0.1) 0 1px 2px, rgba(0,0,0,0.1) 0 2px 4px, rgba(0,0,0,0.1) 0 4px 8px, rgba(0,0,0,0.1) 0 8px 16px, rgba(0,0,0,0.1) 0 16px 32px, rgba(0,0,0,0.1) 0 32px 64px',
    ...(backdropBlur > 0
      ? {
          backdropFilter: `blur(${backdropBlur}px) saturate(130%)`,
          WebkitBackdropFilter: `blur(${backdropBlur}px) saturate(130%)`,
        }
      : {}),
  }

  // The conic arc that reveals the lit portion of the ring on the cursor's side
  // (unchanged from the port — this is the "ring follows cursor angle" mechanic).
  const borderConic = `conic-gradient(from ${angleDeg} at center, black ${coneSpread}%, transparent ${coneSpread + 15}%, transparent ${100 - coneSpread - 15}%, black ${100 - coneSpread}%)`

  const borderLayerStyle = {
    border: '1px solid transparent',
    background: [
      `linear-gradient(${backgroundColor} 0 100%) padding-box`,
      'linear-gradient(rgb(255 255 255 / 0%) 0% 100%) border-box',
      ...borderBg,
    ].join(', '),
    opacity: borderOpacity,
    // Mask = conic arc INTERSECT the 1px border ring. The ring restriction
    // (border-box XOR padding-box) confines the mesh to the actual edge so it can
    // NEVER paint the interior — the original port relied on the opaque `#120F17`
    // knockout to hide the interior, but our translucent glass `backgroundColor`
    // let the mesh bleed across the whole card and animate with the pointer. This
    // restores the reference's crisp-1px-ring appearance without that bleed; the
    // conic-follows-cursor + opacity gating above are untouched. Standard mask
    // longhands only (no -webkit-*) so the two composite value-spaces can't
    // conflict on the 3-layer chain in Chromium.
    maskImage: `${borderConic}, linear-gradient(#000 0 0), linear-gradient(#000 0 0)`,
    maskClip: 'border-box, padding-box, border-box',
    maskComposite: 'intersect, exclude, add',
    transition: isVisible ? 'opacity 0.25s ease-out' : 'opacity 0.75s ease-in-out',
  } as CSSProperties

  // NOTE: the original "mesh gradient fill near edges" (padding-box, soft-light,
  // opacity borderOpacity * fillOpacity) layer has been REMOVED entirely (its
  // <div> is gone from the render below, not merely hidden). That layer reflected
  // the mesh across the whole card interior on hover, which — over a translucent
  // glass card — read as the card's own background animating with the pointer.
  // The card background must stay perfectly static, and the border ring + outer
  // glow already provide the hover reaction, so the fill layer is dropped.

  const glowOuterStyle = {
    inset: `${-glowRadius}px`,
    maskImage: `conic-gradient(from ${angleDeg} at center, black 2.5%, transparent 10%, transparent 90%, black 97.5%)`,
    WebkitMaskImage: `conic-gradient(from ${angleDeg} at center, black 2.5%, transparent 10%, transparent 90%, black 97.5%)`,
    opacity: glowOpacity,
    mixBlendMode: 'plus-lighter',
    transition: isVisible ? 'opacity 0.25s ease-out' : 'opacity 0.75s ease-in-out',
  } as CSSProperties

  const glowInnerStyle: CSSProperties = {
    inset: `${glowRadius}px`,
    boxShadow: buildBoxShadow(glowColor, glowIntensity),
  }

  return (
    <div
      ref={cardRef}
      onPointerMove={handlePointerMove}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      className={`relative grid isolate border border-white/15 ${className}`}
      style={rootStyle}
    >
      {/* mesh gradient border ring (masked to the 1px edge — no interior bleed) */}
      <div className="absolute inset-0 rounded-[inherit] -z-[1]" style={borderLayerStyle} />

      {/* outer glow */}
      <span
        className="absolute pointer-events-none z-[1] rounded-[inherit]"
        style={glowOuterStyle}
      >
        <span className="absolute rounded-[inherit]" style={glowInnerStyle} />
      </span>

      <div className="flex flex-col relative overflow-auto z-[1]">{children}</div>
    </div>
  )
}

export default BorderGlow
