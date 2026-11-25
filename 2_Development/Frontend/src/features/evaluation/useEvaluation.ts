import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getEvaluationBenchmark,
  getEvaluationRun,
  listEvaluationRuns,
  startEvaluationRun,
  type EvaluationBenchmark,
  type EvaluationMode,
  type EvaluationRun,
  type RewardId,
  type StartEvaluationInput,
} from '@/lib/api'
import { describeError, useAsyncRun } from '@/lib/useAsyncRun'

function isActive(run: EvaluationRun) {
  return run.status === 'queued' || run.status === 'running'
}

function latestRun(previous: EvaluationRun | undefined, next: EvaluationRun) {
  return previous && previous.updated_at > next.updated_at ? previous : next
}

export function useEvaluation(path: string) {
  const [benchmark, setBenchmark] = useState<EvaluationBenchmark | null>(null)
  const [runs, setRuns] = useState<EvaluationRun[]>([])
  const [checked, setChecked] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [mode, setMode] = useState<EvaluationMode>('pilot')
  const [pilotSeed, setPilotSeed] = useState<number | null>(null)
  const [pilotLimit, setPilotLimit] = useState('')
  const [selections, setSelections] = useState<
    Partial<Record<number, Partial<Record<RewardId, string>>>>
  >({})
  const version = useRef(0)
  const { run: submit, state: submission } = useAsyncRun<EvaluationRun>()

  const refresh = useCallback(async () => {
    const requestId = ++version.current
    const [profile, history] = await Promise.allSettled([
      getEvaluationBenchmark(),
      listEvaluationRuns(),
    ])
    if (requestId !== version.current) return
    if (profile.status === 'fulfilled') setBenchmark(profile.value)
    if (history.status === 'fulfilled') {
      setRuns((previous) => {
        const previousById = new Map(previous.map((run) => [run.id, run]))
        return history.value.map((run) => latestRun(previousById.get(run.id), run))
      })
      setPollError(null)
    }
    setLoadError(
      profile.status === 'rejected'
        ? describeError(profile.reason)
        : history.status === 'rejected'
          ? describeError(history.reason)
          : null,
    )
    setChecked(true)
  }, [])

  const onResultsPage = path === '/evaluation'
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => {
      window.clearTimeout(timer)
      version.current += 1
    }
  }, [onResultsPage, refresh])

  const active = runs.find(isActive)
  const activeId = active?.id
  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    let timer: number

    const poll = () => {
      timer = window.setTimeout(async () => {
        try {
          const updated = await getEvaluationRun(activeId)
          if (cancelled) return
          setRuns((previous) =>
            previous.map((run) => (run.id === activeId ? latestRun(run, updated) : run)),
          )
          setPollError(null)
          if (!isActive(updated)) return
        } catch (error) {
          if (cancelled) return
          setPollError(describeError(error))
        }
        if (!cancelled) poll()
      }, 2000)
    }

    poll()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activeId])

  const start = useCallback(
    async (input: StartEvaluationInput) => {
      const run = await submit(() => startEvaluationRun(input))
      if (!run) {
        await refresh()
        return null
      }
      // Invalidate any list request that started before the POST finished.
      version.current += 1
      setRuns((previous) => [
        latestRun(previous.find((item) => item.id === run.id), run),
        ...previous.filter((item) => item.id !== run.id),
      ])
      setSelectedRunId(run.id)
      setPollError(null)
      return run
    },
    [refresh, submit],
  )

  const setAdapter = useCallback((seed: number, reward: RewardId, id: string) => {
    setSelections((previous) => ({
      ...previous,
      [seed]: { ...previous[seed], [reward]: id },
    }))
  }, [])

  return {
    benchmark,
    runs,
    active,
    checked,
    error: loadError ?? pollError,
    refresh,
    mode,
    setMode,
    pilotSeed,
    setPilotSeed,
    pilotLimit,
    setPilotLimit,
    selections,
    setAdapter,
    selectedRunId,
    setSelectedRunId,
    start,
    submitting: submission.status === 'running',
    submitError: submission.status === 'failed' ? submission.error : null,
  }
}
