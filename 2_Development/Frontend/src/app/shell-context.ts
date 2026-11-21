import { useOutletContext } from 'react-router'
import type { usePipeline } from '@/features/pipeline/usePipeline'
import type { useHealth } from '@/lib/useHealth'
import type { useSystemMemory } from '@/lib/useSystemMemory'

/**
 * State the shell owns and routed pages need. Passed through the router's
 * outlet context rather than a bespoke provider, since the shell is already the
 * only thing wrapping every page.
 *
 * The pipeline belongs here rather than inside the pipeline page because the
 * ids it produces are what the later sections run against: retrieval needs a
 * conversation id from the indexed partition, and the reward build needs the
 * prepared id. Holding that state in one page would drop it the moment the user
 * moved to the section that consumes it.
 */
export type ShellContext = {
  health: ReturnType<typeof useHealth>
  pipeline: ReturnType<typeof usePipeline>
  systemMemory: ReturnType<typeof useSystemMemory>
}

export function useShell() {
  return useOutletContext<ShellContext>()
}
