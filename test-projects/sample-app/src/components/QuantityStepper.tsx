interface QuantityStepperProps {
  quantity: number
  onChange: (quantity: number) => void
}

/** +/- stepper for adjusting a cart line quantity. */
export default function QuantityStepper({
  quantity,
  onChange,
}: QuantityStepperProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        className="h-7 w-7 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200"
        onClick={() => onChange(quantity - 1)}
        aria-label="Decrease quantity"
      >
        −
      </button>
      <span className="w-6 text-center text-sm font-medium">{quantity}</span>
      <button
        className="h-7 w-7 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200"
        onClick={() => onChange(quantity + 1)}
        aria-label="Increase quantity"
      >
        +
      </button>
    </div>
  )
}
