import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listSavedRewardDatasets,
  listTrainingRuns,
  type SavedRewardDataset,
  type TrainingRun,
} from '@/lib/api'
import { describeError } from '@/lib/useAsyncRun'

export function isActiveRun(run: TrainingRun) {
  return run.status === 'queued' || run.status === 'running'
}

export function useArtifacts(buildId: string | undefined, path: string) {
  const [datasets, setDatasets] = useState<SavedRewardDataset[]>([])
  const [runs, setRuns] = useState<TrainingRun[]>([])
  const [checked, setChecked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const version = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++version.current
    const [saved, trained] = await Promise.allSettled([
      listSavedRewardDatasets(),
      listTrainingRuns(),
    ])
    if (requestId !== version.current) return
    if (saved.status === 'fulfilled') setDatasets(saved.value)
    if (trained.status === 'fulfilled') setRuns(trained.value)
    setError(
      saved.status === 'rejected'
        ? describeError(saved.reason)
        : trained.status === 'rejected'
          ? describeError(trained.reason)
          : null,
    )
    setChecked(true)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => {
      window.clearTimeout(timer)
      version.current += 1
    }
  }, [refresh, buildId, path])

  const active = runs.find(isActiveRun)
  const activeId = active?.id
  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    let timer: number
    const poll = () => {
      timer = window.setTimeout(() => {
        void refresh().then(() => {
          if (!cancelled) poll()
        })
      }, 2000)
    }
    poll()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activeId, refresh])

  return { datasets, runs, active, checked, error, refresh }
}

export type Artifacts = ReturnType<typeof useArtifacts>
