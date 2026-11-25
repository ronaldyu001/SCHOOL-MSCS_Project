import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  checkReady,
  listPrepared,
  type Partition,
  type PreparedHandle,
  type ReadinessResponse,
} from '@/lib/api'

export type WorkspaceStatus = 'checking' | 'empty' | 'ready'

/**
 * Does this workspace have data to work with yet?
 *
 * Both halves live on the backend, so the answer survives a reload: the
 * collection holds the indexed memories, and the durable workspace holds the prepared
 * dataset that questions and training runs are drawn from. Index availability is verified against Qdrant. The app routes on
 * this, which is why it is read once here and shared rather than fetched
 * again by every page that happens to care.
 */
export function useWorkspace() {
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null)
  const [handles, setHandles] = useState<PreparedHandle[]>([])
  const [checked, setChecked] = useState(false)

  const load = useCallback(async () => {
    const [next, prepared] = await Promise.all([
      checkReady().catch(() => null),
      listPrepared().catch(() => [] as PreparedHandle[]),
    ])
    return { next, prepared }
  }, [])

  useEffect(() => {
    let cancelled = false
    void load().then(({ next, prepared }) => {
      if (cancelled) return
      setReadiness(next)
      setHandles(prepared)
      setChecked(true)
    })
    return () => {
      cancelled = true
    }
  }, [load])

  const refresh = useCallback(async () => {
    const { next, prepared } = await load()
    setReadiness(next)
    setHandles(prepared)
    setChecked(true)
  }, [load])

  return useMemo(() => {
    const indexed = Number(readiness?.facts.indexed_memories ?? 0)
    const latest =
      handles.findLast((handle) =>
        Object.values(handle.partitions).some((partition) => partition.indexed),
      ) ??
      handles.at(-1) ??
      null
    const status: WorkspaceStatus = !checked
      ? 'checking'
      : indexed > 0 &&
          latest !== null &&
          Object.values(latest.partitions).some((partition) => partition.indexed)
        ? 'ready'
        : 'empty'

    return {
      status,
      indexedMemories: indexed,
      handles,
      latest,
      preparedId: latest?.prepared_id ?? null,
      conversationsIn: (partition: Partition) =>
        latest?.partitions[partition].conversation_ids ?? [],
      refresh,
    }
  }, [checked, handles, readiness, refresh])
}

export type Workspace = ReturnType<typeof useWorkspace>
