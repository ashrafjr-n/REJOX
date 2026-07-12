interface RatingProps {
  /** Score from 0-5. */
  value: number
}

/** Renders a row of five stars using a flex layout. */
export default function Rating({ value }: RatingProps) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`Rated ${value} of 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={i < value ? 'text-amber-400' : 'text-slate-300'}
        >
          ★
        </span>
      ))}
    </div>
  )
}
