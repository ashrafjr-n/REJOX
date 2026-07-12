import { useEffect, useState } from 'react'

interface FetchState<T> {
  data: T | null
  loading: boolean
  error: Error | null
}

/**
 * Small custom hook that runs an async loader and tracks
 * loading / error / data state. Re-runs when `deps` change.
 */
export function useFetch<T>(
  loader: () => Promise<T>,
  deps: unknown[] = [],
): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    let active = true
    setState({ data: null, loading: true, error: null })

    loader()
      .then((data) => {
        if (active) setState({ data, loading: false, error: null })
      })
      .catch((error: Error) => {
        if (active) setState({ data: null, loading: false, error })
      })

    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}
