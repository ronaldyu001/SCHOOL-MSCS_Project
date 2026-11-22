import { useOutletContext } from 'react-router'
import type { Artifacts } from '@/features/artifacts/useArtifacts'
import type { useModel } from '@/features/harness/useModel'
import type { usePipeline } from '@/features/pipeline/usePipeline'
import type { useRetrieval } from '@/features/retrieval/useRetrieval'
import type {
  useRewardBuild,
  useRewardCatalogue,
} from '@/features/rewards/useRewardBuild'
import type { useHealth } from '@/lib/useHealth'
import type { useSystemMemory } from '@/lib/useSystemMemory'
import type { DataReadiness } from './data-readiness'
import type { useWorkspace } from './useWorkspace'

/**
 * What the shell already knows, handed to the hooks it owns.
 *
 * The run hooks below need the pipeline and the workspace, and they used to
 * reach for them through `useShell`. That works from a page but not from the
 * shell itself, which sits above the outlet the context is published on — so
 * they take it as an argument instead. It also makes the dependency visible at
 * the call site rather than hidden two levels down.
 */
export type ShellData = {
  pipeline: ReturnType<typeof usePipeline>
  /** Whether there is data to work with, shared so no page refetches it. */
  workspace: ReturnType<typeof useWorkspace>
  /**
   * The checkpoint every run uses. One per session, not one per page: the
   * backend keeps a single model resident and evicts it on a switch, so pages
   * free to disagree would both split the results and thrash the weights.
   */
  model: ReturnType<typeof useModel>
}

/**
 * State the shell owns and routed pages need. Passed through the router's
 * outlet context rather than a bespoke provider, since the shell is already the
 * only thing wrapping every page.
 *
 * Everything a run produces lives here, not in the page that shows it. The
 * router unmounts a page the moment you leave it, so state held in one was
 * state the navigation could throw away: a finished reward build, a search and
 * its comparison, a half-filled form. The backend had already done the work in
 * some of those cases and the answer was simply dropped. Holding it at the
 * shell means only the actions on these objects change them — switching tabs
 * is not one.
 *
 * The pipeline was always here for a related reason: the ids it produces are
 * what the later sections run against, and a page that owned them would drop
 * them on the way to the section that consumes them.
 */
export type ShellContext = ShellData & {
  health: ReturnType<typeof useHealth>
  systemMemory: ReturnType<typeof useSystemMemory>
  /**
   * The workspace and the pipeline read together: whether the data is there,
   * on its way, or missing. Pages gate on this rather than on `workspace`
   * alone, so none of them can contradict the header about it.
   */
  data: DataReadiness
  /** The search page's settings, runs and results. */
  retrieval: ReturnType<typeof useRetrieval>
  /** The training page's build settings, run and results. */
  rewardBuild: ReturnType<typeof useRewardBuild>
  /** Reward definitions, fetched once for the session. */
  rewardCatalogue: ReturnType<typeof useRewardCatalogue>
  artifacts: Artifacts
}

export function useShell() {
  return useOutletContext<ShellContext>()
}
