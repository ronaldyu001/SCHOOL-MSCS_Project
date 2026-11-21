import { useCallback, useEffect, useState } from 'react'
import { getSystemMemory, type MemorySnapshot } from './api'

/**
 * RAM on the backend's host, read once on mount and on demand.
 *
 * Worth surfacing because every expensive thing in this project runs in that
 * one process: the encoder, the reader model and the reward build all share it,
 * and a build that dies without a message is usually the host running out of
 * memory rather than a bug in the pipeline.
 */
export function useSystemMemory() {
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null)

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await getSystemMemory())
    } catch {
      // An unreachable backend is already reported by the health indicator.
      setSnapshot(null)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void getSystemMemory()
      .then((next) => {
        if (!cancelled) setSnapshot(next)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  return { snapshot, refresh }
}
