import { useCallback, useEffect, useState } from 'react'
import { getModelInfo, type ModelInfo } from '@/lib/api'
import { describeError } from '@/lib/useAsyncRun'

/**
 * The configured harness, read without loading any weights.
 *
 * Every page that can spend minutes on a model should be able to say which
 * checkpoint it will use and whether that checkpoint is already resident, so
 * the first call's delay is explained before it happens rather than after.
 */
export function useModelInfo() {
  const [info, setInfo] = useState<ModelInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setInfo(await getModelInfo())
      setError(null)
    } catch (caught) {
      setError(describeError(caught))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void getModelInfo()
      .then((next) => {
        if (!cancelled) setInfo(next)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught))
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { info, error, refresh }
}
