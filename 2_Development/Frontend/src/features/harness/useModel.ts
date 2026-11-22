import { useCallback, useMemo, useState } from 'react'
import { useModelInfo } from './useModelInfo'

/**
 * Which checkpoint this session runs against.
 *
 * One setting for the whole app rather than one per page. The backend holds a
 * single model at a time and evicts the old one on a switch, so two pages free
 * to disagree did not just risk a search and a training build coming from
 * different checkpoints — alternating between them would unload and reload
 * weights on every run.
 *
 * Blank means the configured default, which is also what the API means by a
 * null `model_id`. Keeping the empty string as the resting value, rather than
 * copying the default id into the box, is what lets the default move without
 * this session pinning the old one by accident.
 */
export function useModel() {
  const { info, error, refresh } = useModelInfo()
  const [modelId, setModelId] = useState('')
  const [revision, setRevision] = useState('')

  const reset = useCallback(() => {
    setModelId('')
    setRevision('')
  }, [])

  return useMemo(() => {
    const chosenId = modelId.trim()
    const chosenRevision = revision.trim()
    const isDefault = chosenId === ''
    const activeId = isDefault ? (info?.default_model_id ?? null) : chosenId
    const activeRevision = isDefault
      ? (info?.default_revision ?? null)
      : chosenRevision || null

    // The cache keys on both halves, so a revision change is a reload too.
    const loadedId = info?.loaded_model_id ?? null
    const swaps =
      loadedId !== null &&
      activeId !== null &&
      (loadedId !== activeId || (info?.loaded_revision ?? null) !== activeRevision)

    return {
      /** Raw field values. Empty means "use the default". */
      modelId,
      revision,
      setModelId,
      setRevision,
      reset,
      /** What a run will actually use, once the default is filled in. */
      activeId,
      activeRevision,
      isDefault,
      /** True when the next run has to unload the resident model first. */
      swaps,
      info,
      error,
      refresh,
    }
  }, [error, info, modelId, refresh, reset, revision])
}

export type Model = ReturnType<typeof useModel>
