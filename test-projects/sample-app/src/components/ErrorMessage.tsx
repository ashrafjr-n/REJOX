interface ErrorMessageProps {
  message: string
}

/** Inline error banner. */
export default function ErrorMessage({ message }: ErrorMessageProps) {
  return (
    <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
      {message}
    </div>
  )
}
