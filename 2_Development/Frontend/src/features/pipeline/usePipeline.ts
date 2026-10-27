import { useCallback, useReducer, useRef, useState } from 'react'
import {
  ApiError,
  createSplit,
  indexDataset,
  loadDataset,
  prepareDataset,
  type CreateSplitResponse,
  type IndexDatasetResponse,
  type LoadDatasetResponse,
  type Partition,
  type PrepareDatasetResponse,
  type QACategory,
} from '@/lib/api'

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

export type PipelineSettings = {
  path: string
  trainSize: number
  validationSize: number
  testSize: number
  seed: number
  /** Empty means "no filter", which the API expects as null. */
  categories: QACategory[]
  partition: Partition
  batchSize: number
}

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
  seed: 123,
  categories: [],
  partition: 'train',
  batchSize: 64,
}

/**
 * A 70/10/20 starting point that always sums to `total`, since the backend
 * rejects any split that does not account for every conversation.
 */
export function proposeSplit(total: number) {
  const trainSize = Math.min(total, Math.max(0, Math.round(total * 0.7)))
  const testSize = Math.min(total - trainSize, Math.max(0, Math.round(total * 0.2)))
  return { trainSize, validationSize: total - trainSize - testSize, testSize }
}

function describe(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return error instanceof Error ? error.message : 'Unexpected error.'
}

export function usePipeline() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE)
  const [settings, setSettings] = useState<PipelineSettings>(DEFAULT_SETTINGS)
  const [runningAll, setRunningAll] = useState(false)
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
            error: describe(error),
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
      // A freshly loaded dataset gets a split proposal that actually sums.
      if (result) write(proposeSplit(result.conversation_count))
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
    ) => track('split', () => createSplit(datasetId, sizes)),
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
  const runAll = useCallback(async () => {
    setRunningAll(true)
    try {
      const current = settingsRef.current
      const load = await runLoad(current.path)
      if (!load) return

      // runLoad has just reproposed the sizes, so use those rather than the
      // form values, which were set for whatever was loaded before.
      const sizes = proposeSplit(load.conversation_count)
      const split = await runSplit(load.dataset_id, { ...sizes, seed: current.seed })
      if (!split) return

      const prepared = await runPrepare(
        load.dataset_id,
        split.split_id,
        current.categories,
      )
      if (!prepared) return

      await runIndex(
        load.dataset_id,
        prepared.prepared_id,
        current.partition,
        current.batchSize,
      )
    } finally {
      setRunningAll(false)
    }
  }, [runLoad, runSplit, runPrepare, runIndex])

  const reset = useCallback(() => {
    dispatch({ type: 'reset' })
    setSettings(DEFAULT_SETTINGS)
    settingsRef.current = DEFAULT_SETTINGS
  }, [])

  const busy = PHASE_ORDER.some((phase) => state[phase].status === 'running')

  return {
    state,
    settings,
    update,
    patch: write,
    busy,
    runningAll,
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
