import { useCallback, useReducer, useRef, useState } from 'react'
import {
  createSplit,
  indexDataset,
  loadDataset,
  prepareDataset,
  type CreateSplitResponse,
  type DatasetSplit,
  type EvaluationBenchmark,
  type IndexDatasetResponse,
  type LoadDatasetResponse,
  type Partition,
  type PrepareDatasetResponse,
  type QACategory,
} from '@/lib/api'
import { describeError } from '@/lib/useAsyncRun'
import { benchmarkSetupKey, matchesBenchmarkSplit } from './benchmark'

export const PHASE_ORDER = ['load', 'split', 'prepare', 'index'] as const

export type PhaseKey = (typeof PHASE_ORDER)[number]

/** What a successful run of each phase hands back. */
export type PhaseResults = {
  load: LoadDatasetResponse
  split: CreateSplitResponse
  prepare: PrepareDatasetResponse
  index: IndexDatasetResponse
}

export type PhaseRun<T> =
  | { status: 'idle' }
  | { status: 'running'; startedAt: number }
  | { status: 'done'; result: T; elapsedMs: number }
  | { status: 'failed'; error: string; elapsedMs: number }

export type PipelineState = { [K in PhaseKey]: PhaseRun<PhaseResults[K]> }

const IDLE = { status: 'idle' } as const

const INITIAL_STATE: PipelineState = {
  load: IDLE,
  split: IDLE,
  prepare: IDLE,
  index: IDLE,
}

type Action =
  | { type: 'start'; phase: PhaseKey; startedAt: number }
  | { type: 'settle'; phase: PhaseKey; run: PhaseRun<PhaseResults[PhaseKey]> }
  | { type: 'reset' }

/**
 * Clear every phase after `phase`.
 *
 * This is the one rule the whole screen depends on. Each phase hands an opaque
 * id to the next, and the backend keeps that id in its own app state, so a
 * fresh load invalidates the split that referenced the old dataset, a fresh
 * split invalidates the prepared partitions, and so on. Leaving a stale
 * downstream result on screen would show numbers that no longer describe
 * anything the backend would still accept.
 */
function invalidateAfter(state: PipelineState, phase: PhaseKey): PipelineState {
  const next = { ...state }
  for (const key of PHASE_ORDER.slice(PHASE_ORDER.indexOf(phase) + 1)) next[key] = IDLE
  return next
}

/* TypeScript cannot correlate a `PhaseKey` variable with its matching result
 * type through a computed key, so the write is asserted here, once. The generic
 * `track` below is what actually keeps phase and result type in step, and it is
 * the only caller. */
function writePhase(
  state: PipelineState,
  phase: PhaseKey,
  run: PhaseRun<PhaseResults[PhaseKey]>,
): PipelineState {
  return { ...state, [phase]: run } as PipelineState
}

function reducer(state: PipelineState, action: Action): PipelineState {
  switch (action.type) {
    case 'start':
      return writePhase(invalidateAfter(state, action.phase), action.phase, {
        status: 'running',
        startedAt: action.startedAt,
      })
    case 'settle':
      return writePhase(state, action.phase, action.run)
    case 'reset':
      return INITIAL_STATE
  }
}

/** The three partitions as whole percentages of the dataset, summing to 100. */
export type SplitShares = { train: number; validation: number; test: number }

export type SplitSizes = {
  trainSize: number
  validationSize: number
  testSize: number
}

export type PipelineSettings = {
  path: string
  trainSize: number
  validationSize: number
  testSize: number
  /**
   * How to divide the conversations when the whole thing runs in one go.
   *
   * The three sizes above are exact conversation counts, and nobody can choose
   * those before a load: they have to sum to a total the backend has not
   * reported yet. Percentages can be chosen up front, so they are what the
   * one-button run reads.
   */
  splitShares: SplitShares
  seed: number
  /** Empty means "no filter", which the API expects as null. */
  categories: QACategory[]
  partition: Partition
  batchSize: number
}

export const DEFAULT_SPLIT_SHARES: SplitShares = {
  train: 70,
  validation: 10,
  test: 20,
}

/** The splits worth one tap, shared so the setup page and the split step cannot
 *  drift into offering different ones. */
export const SPLIT_PRESETS: { value: string; label: string; shares: SplitShares }[] = [
  { value: '70-10-20', label: '70 / 10 / 20', shares: DEFAULT_SPLIT_SHARES },
  {
    value: '80-10-10',
    label: '80 / 10 / 10',
    shares: { train: 80, validation: 10, test: 10 },
  },
]

/**
 * Defaults track the backend: `/data` is where docker-compose mounts the
 * dataset read-only, and the seed and batch size come from Config in
 * infrastructure/config.py.
 */
const DEFAULT_SETTINGS: PipelineSettings = {
  path: '/data/locomo10.json',
  trainSize: 0,
  validationSize: 0,
  testSize: 0,
  splitShares: DEFAULT_SPLIT_SHARES,
  seed: 123,
  categories: [],
  partition: 'train',
  batchSize: 64,
}

/**
 * Conversation counts for a set of shares, always summing to `total`, since the
 * backend rejects any split that does not account for every conversation. What
 * rounding leaves over lands in validation, the partition nothing is reported
 * on, rather than in the held-out test set.
 */
export function sizesFor(total: number, { train, test }: SplitShares): SplitSizes {
  const trainSize = Math.min(total, Math.max(0, Math.round((total * train) / 100)))
  const testSize = Math.min(
    total - trainSize,
    Math.max(0, Math.round((total * test) / 100)),
  )
  return { trainSize, validationSize: total - trainSize - testSize, testSize }
}

/** The shares three counts describe, so sizes typed into the split step survive
 *  a later one-button run instead of being quietly replaced. Validation takes
 *  the remainder, so these always come to 100. */
export function sharesOf({
  trainSize,
  validationSize,
  testSize,
}: SplitSizes): SplitShares {
  const total = trainSize + validationSize + testSize
  if (total <= 0) return DEFAULT_SPLIT_SHARES
  const train = Math.round((trainSize / total) * 100)
  const test = Math.round((testSize / total) * 100)
  return { train, validation: 100 - train - test, test }
}

export function usePipeline() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE)
  const [settings, setSettings] = useState<PipelineSettings>(DEFAULT_SETTINGS)
  const [runningAll, setRunningAll] = useState(false)
  const [benchmarkSetup, setBenchmarkSetup] = useState<{
    key: string
    preparedId: string
  } | null>(null)
  // Mirror of `settings` for the sequential run, which cannot observe the state
  // updates it has just queued.
  const settingsRef = useRef(settings)

  const write = useCallback((changes: Partial<PipelineSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...changes }
      settingsRef.current = next
      return next
    })
  }, [])

  const update = useCallback(
    <K extends keyof PipelineSettings>(key: K, value: PipelineSettings[K]) => {
      write({ [key]: value } as Partial<PipelineSettings>)
    },
    [write],
  )

  /** Wraps one API call in the start/settle transitions, with timing. */
  const track = useCallback(
    async <K extends PhaseKey>(
      phase: K,
      call: () => Promise<PhaseResults[K]>,
    ): Promise<PhaseResults[K] | null> => {
      const startedAt = performance.now()
      dispatch({ type: 'start', phase, startedAt })
      try {
        const result = await call()
        dispatch({
          type: 'settle',
          phase,
          run: {
            status: 'done',
            result,
            elapsedMs: Math.round(performance.now() - startedAt),
          },
        })
        return result
      } catch (error) {
        dispatch({
          type: 'settle',
          phase,
          run: {
            status: 'failed',
            error: describeError(error),
            elapsedMs: Math.round(performance.now() - startedAt),
          },
        })
        return null
      }
    },
    [],
  )

  const runLoad = useCallback(
    async (path: string) => {
      const result = await track('load', () => loadDataset(path))
      // Now that the conversation count is known, the chosen proportions can
      // become counts that actually sum to it.
      if (result)
        write(sizesFor(result.conversation_count, settingsRef.current.splitShares))
      return result
    },
    [track, write],
  )

  const runSplit = useCallback(
    (
      datasetId: string,
      sizes: {
        trainSize: number
        validationSize: number
        testSize: number
        seed: number
      },
      expected?: DatasetSplit,
    ) =>
      track('split', async () => {
        const split = await createSplit(datasetId, sizes)
        if (expected && !matchesBenchmarkSplit(split, expected)) {
          throw new Error(
            'The conversation IDs do not match the frozen benchmark split.',
          )
        }
        return split
      }),
    [track],
  )

  const runPrepare = useCallback(
    (datasetId: string, splitId: string, categories: QACategory[]) =>
      track('prepare', () =>
        prepareDataset(datasetId, {
          splitId,
          categories: categories.length > 0 ? categories : null,
        }),
      ),
    [track],
  )

  const runIndex = useCallback(
    (datasetId: string, preparedId: string, partition: Partition, batchSize: number) =>
      track('index', () =>
        indexDataset(datasetId, { preparedId, partition, batchSize }),
      ),
    [track],
  )

  /** Load → split → prepare → index, stopping at the first failure. */
  const runAll = useCallback(
    async (benchmark?: EvaluationBenchmark) => {
      setRunningAll(true)
      try {
        const current = settingsRef.current
        const load = await runLoad(current.path)
        if (!load) return

        const sizes = benchmark
          ? {
              trainSize: benchmark.split.train_conversation_ids.length,
              validationSize: benchmark.split.validation_conversation_ids.length,
              testSize: benchmark.split.test_conversation_ids.length,
            }
          : sizesFor(load.conversation_count, current.splitShares)
        const seed = benchmark?.split_seed ?? current.seed
        const categories = benchmark?.categories ?? current.categories
        const partition = benchmark ? 'train' : current.partition
        if (benchmark) {
          write({ ...sizes, splitShares: sharesOf(sizes), seed, categories, partition })
        }
        const split = await runSplit(
          load.dataset_id,
          { ...sizes, seed },
          benchmark?.split,
        )
        if (!split) return

        const prepared = await runPrepare(load.dataset_id, split.split_id, categories)
        if (!prepared) return

        const indexed = await runIndex(
          load.dataset_id,
          prepared.prepared_id,
          partition,
          current.batchSize,
        )
        if (indexed && benchmark) {
          setBenchmarkSetup({
            key: benchmarkSetupKey(benchmark),
            preparedId: indexed.prepared_id,
          })
        }
      } finally {
        setRunningAll(false)
      }
    },
    [runLoad, runSplit, runPrepare, runIndex, write],
  )

  const reset = useCallback(() => {
    dispatch({ type: 'reset' })
    setSettings(DEFAULT_SETTINGS)
    settingsRef.current = DEFAULT_SETTINGS
    setBenchmarkSetup(null)
  }, [])

  const busy = PHASE_ORDER.some((phase) => state[phase].status === 'running')

  return {
    state,
    settings,
    update,
    patch: write,
    busy,
    runningAll,
    benchmarkSetup,
    runLoad,
    runSplit,
    runPrepare,
    runIndex,
    runAll,
    reset,
  }
}

/**
 * View status for a phase: a phase that has not run yet is `blocked` when its
 * prerequisite is missing and `idle` when it is ready to go, which is the
 * difference between "you cannot do this" and "you have not yet".
 */
export function statusOf(
  run: PhaseRun<unknown>,
  blocked: boolean,
): 'blocked' | 'idle' | 'running' | 'done' | 'failed' {
  return run.status === 'idle' ? (blocked ? 'blocked' : 'idle') : run.status
}
