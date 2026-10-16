import { useCallback, useEffect, useState } from 'react'
import { getErrorMessage } from '../api/client'

/**
 * Run `fetcher({ signal })` on mount and whenever `deps` change.
 * Returns `{ data, loading, error, reload, setData }`; stale requests are aborted.
 */
export function useFetch(fetcher, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: '' })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState((previous) => ({ ...previous, loading: true, error: '' }))
    fetcher({ signal: controller.signal })
      .then((data) => setState({ data, loading: false, error: '' }))
      .catch((error) => {
        if (controller.signal.aborted) return
        setState((previous) => ({ ...previous, loading: false, error: getErrorMessage(error) }))
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((value) => value + 1), [])
  const setData = useCallback((data) => setState((previous) => ({ ...previous, data })), [])
  return { ...state, reload, setData }
}

/** Debounce a fast-changing value (e.g. a search box). */
export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}
