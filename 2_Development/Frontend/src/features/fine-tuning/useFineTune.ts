import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ApiError,
  getTrainingRun,
  startTrainingRun,
  TRAINING_DEFAULTS,
  TRAINING_LIMITS,
  type EvaluationBenchmark,
  type RewardId,
  type TrainingRun,
  type TrainingSettings,
} from '@/lib/api'
import { describeError, useAsyncRun } from '@/lib/useAsyncRun'

type TrainingPreset = { modelId: string; revision: string; settings: TrainingSettings }
type QueueDataset = { id: string; reward: RewardId }
type CheckpointDefaults = { modelId: string; revision: string }

function pause() {
  return new Promise<void>((resolve) => setTimeout(resolve, 2000))
}

async function waitForTraining(run: TrainingRun) {
  let failures = 0
  while (run.status === 'queued' || run.status === 'running') {
    await pause()
    try {
      run = await getTrainingRun(run.id)
      failures = 0
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        ![0, 502, 503, 504].includes(error.status) ||
        ++failures >= 5
      ) {
        throw error
      }
    }
  }
  if (run.status !== 'completed') {
    throw new Error(run.error ?? `Training ended with status ${run.status}.`)
  }
  return run
}

async function startQueuedTraining(input: Parameters<typeof startTrainingRun>[0]) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await startTrainingRun(input)
    } catch (error) {
      // The previous worker can briefly hold its lease after reporting completion.
      if (!(error instanceof ApiError) || error.status !== 409 || attempt === 5)
        throw error
      await pause()
    }
  }
}

export function benchmarkTrainingSettings(
  benchmark: EvaluationBenchmark,
  seed: number,
): TrainingSettings {
  const settings = benchmark.training
  return {
    seed,
    epochs: settings.epochs,
    learningRate: settings.learning_rate,
    batchSize: settings.batch_size,
    gradientAccumulationSteps: settings.gradient_accumulation_steps,
    maxLength: settings.max_length,
    loraRank: settings.lora_rank,
    loraAlpha: settings.lora_alpha,
  }
}

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
  const [rewardSelection, setRewardSelection] = useState<Partial<
    Record<RewardId, string>
  > | null>(null)
  const [queue, setQueue] = useState<{
    reward: RewardId
    completed: number
    total: number
  } | null>(null)
  const submittingRef = useRef(false)
  const submit = useAsyncRun<TrainingRun | null>()

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
    setQueue(null)
    submit.reset()
  }, [submit])

  /**
   * `datasetId` and the checkpoint defaults come from the page, which knows
   * which saved dataset is selected and what produced it.
   */
  const start = useCallback(
    async (
      datasetId: string,
      fallback: CheckpointDefaults,
      preset?: TrainingPreset,
    ) => {
      if (submittingRef.current) return null
      submittingRef.current = true
      setQueue(null)
      const chosenModel = preset?.modelId ?? (modelId.trim() || fallback.modelId)
      const chosenRevision =
        preset?.revision ??
        (revision.trim() || (chosenModel === fallback.modelId ? fallback.revision : ''))
      try {
        const run = await submit.run(() =>
          startTrainingRun({
            datasetId,
            modelId: chosenModel,
            revision: chosenRevision,
            name: name.trim(),
            settings: preset?.settings ?? settings,
          }),
        )
        if (run) await onStarted()
        return run
      } finally {
        submittingRef.current = false
      }
    },
    [modelId, name, onStarted, revision, settings, submit],
  )

  const startAllRewards = useCallback(
    async (datasets: readonly QueueDataset[], preset: TrainingPreset) => {
      if (submittingRef.current || datasets.length === 0) return
      submittingRef.current = true
      try {
        await submit.run(async () => {
          let latest: TrainingRun | undefined
          for (const [index, dataset] of datasets.entries()) {
            const reward = dataset.reward.toUpperCase()
            const prefix = name.trim()
            const suffix = `${reward} · Seed ${preset.settings.seed}`
            setQueue({
              reward: dataset.reward,
              completed: index,
              total: datasets.length,
            })
            try {
              const run = await startQueuedTraining({
                ...preset,
                datasetId: dataset.id,
                name: prefix
                  ? `${prefix.slice(0, 117 - suffix.length)} · ${suffix}`
                  : suffix,
              })
              await onStarted()
              latest = await waitForTraining(run)
              setQueue({
                reward: dataset.reward,
                completed: index + 1,
                total: datasets.length,
              })
            } catch (error) {
              throw new Error(`${reward}: ${describeError(error)}`, { cause: error })
            } finally {
              await onStarted()
            }
          }
          return latest ?? null
        })
      } finally {
        submittingRef.current = false
      }
    },
    [name, onStarted, submit],
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
      startAllRewards,
      rewardSelection,
      setRewardSelection,
      queue,
      reset,
    }),
    [
      modelId,
      name,
      queue,
      reset,
      revision,
      rewardSelection,
      settings,
      start,
      startAllRewards,
      submit.state,
      update,
    ],
  )
}

export type FineTune = ReturnType<typeof useFineTune>
