import { useCallback, useEffect, useState } from 'react'
import { checkHealth } from './api'

export type HealthState = 'checking' | 'online' | 'offline'

/** Resolves to a state rather than setting one, so both callers below share it. */
async function probe(): Promise<HealthState> {
  try {
    const body = await checkHealth()
    return body.status === 'ok' ? 'online' : 'offline'
  } catch {
    return 'offline'
  }
}

/**
 * Reachability of the backend, checked on mount and on demand. Deliberately not
 * polled — a pipeline run surfaces connection failures where they matter, and a
 * blinking header indicator is noise the rest of the time.
 */
export function useHealth() {
  const [state, setState] = useState<HealthState>('checking')
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)

  useEffect(() => {
    // StrictMode mounts twice in development, so the first probe's result is
    // dropped if this effect has already been torn down.
    let cancelled = false
    void probe().then((next) => {
      if (cancelled) return
      setState(next)
      setCheckedAt(new Date())
    })
    return () => {
      cancelled = true
    }
  }, [])

  const refresh = useCallback(async () => {
    setState('checking')
    setState(await probe())
    setCheckedAt(new Date())
  }, [])

  return { state, checkedAt, refresh }
}
