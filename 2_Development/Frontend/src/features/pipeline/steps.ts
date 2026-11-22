import { PHASE_ORDER, type PhaseKey, type PipelineState } from './usePipeline'

export type SetupStep = {
  key: PhaseKey
  /** What the step is, at rest. */
  label: string
  /** What it is doing, while it runs. */
  doing: string
}

/**
 * The four backend stages, in the words the user sees.
 *
 * They live here rather than on the setup page because other pages have to
 * explain the same run: anything that depends on the data needs to say which
 * step it is waiting on, and two copies of these strings would drift.
 */
export const SETUP_STEPS: SetupStep[] = [
  { key: 'load', label: 'Read the dataset', doing: 'Reading the file' },
  { key: 'split', label: 'Split it up', doing: 'Splitting' },
  { key: 'prepare', label: 'Sort the questions', doing: 'Sorting' },
  {
    key: 'index',
    label: 'Make it searchable',
    doing: 'Indexing, this is the slow one',
  },
]

export type SetupProgress = {
  running: boolean
  /** Steps finished in this run. */
  done: number
  total: number
  /** 1-based place of the running step, for "step 3 of 4". */
  position: number | null
  /** What the running step is doing. */
  doing: string | null
  /** The label of the step that failed, if one did. */
  failed: string | null
}

export function readSetupProgress(state: PipelineState): SetupProgress {
  const running = SETUP_STEPS.findIndex((step) => state[step.key].status === 'running')
  const failed = SETUP_STEPS.find((step) => state[step.key].status === 'failed') ?? null

  return {
    running: running !== -1,
    done: PHASE_ORDER.filter((key) => state[key].status === 'done').length,
    total: SETUP_STEPS.length,
    position: running === -1 ? null : running + 1,
    doing: running === -1 ? null : SETUP_STEPS[running].doing,
    failed: failed?.label ?? null,
  }
}
