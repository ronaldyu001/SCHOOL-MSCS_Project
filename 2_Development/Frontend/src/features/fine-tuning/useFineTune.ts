import { useCallback, useMemo, useState } from 'react'
import {
  startTrainingRun,
  TRAINING_DEFAULTS,
  TRAINING_LIMITS,
  type TrainingRun,
  type TrainingSettings,
} from '@/lib/api'
import { useAsyncRun } from '@/lib/useAsyncRun'

/** Whole numbers everywhere but the learning rate, matching the backend. */
const WHOLE: (keyof TrainingSettings)[] = [
  'seed',
  'epochs',
  'batchSize',
  'gradientAccumulationSteps',
  'maxLength',
  'loraRank',
  'loraAlpha',
]

/**
 * Which settings the backend would reject, checked here first.
 *
 * The bounds are the same ones `TrainingSettings.__post_init__` enforces. A
 * run that is going to be refused should be refused before it is submitted:
 * the alternative is a 422 arriving after the request, phrased in the
 * backend's words rather than beside the field that caused it.
 */
export function invalidSettings(settings: TrainingSettings) {
  const problems = new Map<keyof TrainingSettings, string>()

  for (const key of WHOLE) {
    const [low, high] = TRAINING_LIMITS[key]
    const value = settings[key]
    if (!Number.isInteger(value) || value < low || value > high) {
      problems.set(key, `A whole number from ${low} to ${high}.`)
    }
  }

  const rate = settings.learningRate
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1) {
    problems.set('learningRate', 'Above 0 and no more than 1.')
  }

  return problems
}

/**
 * The fine-tuning form and the request that starts a run.
 *
 * Shell-owned like the other run state: a training run is the longest thing
 * this app can start, so the tab is exactly where somebody will not be sitting
 * while it works. The run itself is tracked by the artifact poll; this holds
 * what you typed to start it.
 */
export function useFineTune(onStarted: () => Promise<void>) {
  const [settings, setSettings] = useState<TrainingSettings>(TRAINING_DEFAULTS)
  const [modelId, setModelId] = useState('')
  const [revision, setRevision] = useState('')
  const [name, setName] = useState('')
  const submit = useAsyncRun<TrainingRun>()

  const update = useCallback(
    <K extends keyof TrainingSettings>(key: K, value: TrainingSettings[K]) => {
      setSettings((current) => ({ ...current, [key]: value }))
    },
    [],
  )

  const reset = useCallback(() => {
    setSettings(TRAINING_DEFAULTS)
    setModelId('')
    setRevision('')
    setName('')
    submit.reset()
  }, [submit])

  /**
   * `datasetId` and the checkpoint defaults come from the page, which knows
   * which saved dataset is selected and what produced it.
   */
  const start = useCallback(
    async (datasetId: string, fallback: { modelId: string; revision: string }) => {
      const chosenModel = modelId.trim() || fallback.modelId
      const chosenRevision =
        revision.trim() || (chosenModel === fallback.modelId ? fallback.revision : '')
      const run = await submit.run(() =>
        startTrainingRun({
          datasetId,
          modelId: chosenModel,
          revision: chosenRevision,
          name: name.trim(),
          settings,
        }),
      )
      if (run) await onStarted()
      return run
    },
    [modelId, name, onStarted, revision, settings, submit],
  )

  return useMemo(
    () => ({
      settings,
      update,
      modelId,
      setModelId,
      revision,
      setRevision,
      name,
      setName,
      problems: invalidSettings(settings),
      state: submit.state,
      submitting: submit.state.status === 'running',
      start,
      reset,
    }),
    [modelId, name, reset, revision, settings, start, submit.state, update],
  )
}

export type FineTune = ReturnType<typeof useFineTune>
