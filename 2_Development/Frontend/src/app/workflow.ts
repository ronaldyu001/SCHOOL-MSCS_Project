import type { Artifacts } from '@/features/artifacts/useArtifacts'
import type { DataReadiness } from './data-readiness'
import type { Requirement, RouteDef } from './routes'

/**
 * `checking` we have not heard back yet, `building` the thing is being made
 * right now, `missing` it does not exist, `error` we could not find out.
 */
export type PrerequisiteState = 'checking' | 'building' | 'missing' | 'error'

export type Prerequisite = {
  requirement: Requirement
  state: PrerequisiteState
}

/**
 * The first step of the guided flow this route is still waiting on.
 *
 * Requirements are listed in flow order on the route, and this returns the
 * earliest unmet one rather than the first that happens to fail: a page that
 * needs both an index and an adapter should send you to the index first,
 * because that is the step you can actually do next.
 */
export function nextRequirement(
  route: RouteDef,
  data: DataReadiness,
  artifacts: Artifacts,
): Prerequisite | null {
  for (const requirement of route.requires ?? []) {
    if (requirement === 'data') {
      if (data.state === 'ready') continue
      return {
        requirement,
        state:
          data.state === 'checking'
            ? 'checking'
            : data.state === 'building'
              ? 'building'
              : 'missing',
      }
    }

    const ready =
      requirement === 'training-data'
        ? artifacts.datasets.some((dataset) => dataset.row_count > 0)
        : artifacts.runs.some((run) => run.status === 'completed')
    if (ready) continue

    // An unfinished run is the same story as an unfinished index: the thing is
    // on its way, so the page says "wait" rather than "go and make one".
    const building = requirement === 'adapter' && artifacts.active !== undefined
    return {
      requirement,
      state: !artifacts.checked
        ? 'checking'
        : artifacts.error
          ? 'error'
          : building
            ? 'building'
            : 'missing',
    }
  }
  return null
}
