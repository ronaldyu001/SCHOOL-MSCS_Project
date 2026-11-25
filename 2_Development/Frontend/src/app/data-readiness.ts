import { readSetupProgress, type SetupProgress } from '@/features/pipeline/steps'
import type { PipelineState } from '@/features/pipeline/usePipeline'
import type { Workspace } from './useWorkspace'

/**
 * `checking` the backend hasn't answered yet, `empty` there is nothing indexed,
 * `building` a setup run is filling it in, `ready` the pages can work.
 */
export type DataState = 'checking' | 'empty' | 'building' | 'ready'

export type DataReadiness = {
  state: DataState
  /** A run is going on top of data that already works, so nothing is blocked. */
  rebuilding: boolean
  /** Where that run has got to, whichever kind it is. */
  progress: SetupProgress
  indexedMemories: number
  prepared: boolean
}

/**
 * One answer to "is there data?", for the whole app.
 *
 * Every page that needs the dataset used to work this out for itself from
 * `workspace.status`, which has no idea whether a setup run is in flight — so
 * opening Search during a run said "nothing to search yet, set up the data"
 * while a setup three steps in was running behind it. Deriving it once, here,
 * means the header, the navigation and each page tell the same story, and
 * switching tabs mid-run never changes it.
 *
 * A run that stopped part way reads as `empty`: there is still nothing to
 * search, and the thing to do about it is the same. Callers that want to say
 * so have `progress.failed`.
 */
export function readDataReadiness(
  workspace: Workspace,
  pipeline: PipelineState,
): DataReadiness {
  const progress = readSetupProgress(pipeline)
  const usable = workspace.status === 'ready'

  const state: DataState = usable
    ? 'ready'
    : workspace.status === 'checking'
      ? 'checking'
      : progress.running
        ? 'building'
        : 'empty'

  return {
    state,
    rebuilding: usable && progress.running,
    progress,
    indexedMemories: workspace.indexedMemories,
    prepared: workspace.handles.length > 0 || pipeline.prepare.status === 'done',
  }
}
