interface QuantityStepperProps {
  quantity: number
  onChange: (quantity: number) => void
  darkMode?: boolean
}

/** +/- stepper for adjusting a cart line quantity. */
export default function QuantityStepper({
  quantity,
  onChange,
  darkMode = false,
}: QuantityStepperProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        className={`h-7 w-7 rounded-md ${
          darkMode
            ? 'bg-slate-700 text-slate-100 hover:bg-slate-600'
            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
        }`}
        onClick={() => onChange(quantity - 1)}
        aria-label="Decrease quantity"
      >
        −
      </button>
      <span className={`w-6 text-center text-sm font-medium ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>
        {quantity}
      </span>
      <button
        className={`h-7 w-7 rounded-md ${
          darkMode
            ? 'bg-slate-700 text-slate-100 hover:bg-slate-600'
            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
        }`}
        onClick={() => onChange(quantity + 1)}
        aria-label="Increase quantity"
      >
        +
      </button>
    </div>
  )
}
