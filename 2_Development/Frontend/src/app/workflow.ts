import type { Artifacts } from '@/features/artifacts/useArtifacts'
import type { DataReadiness } from './data-readiness'
import type { Requirement, RouteDef } from './routes'

type Prerequisite = {
  requirement: Requirement
  state: 'checking' | 'missing' | 'error'
}

export function nextRequirement(
  route: RouteDef,
  data: DataReadiness,
  artifacts: Artifacts,
): Prerequisite | null {
  for (const requirement of route.requires ?? []) {
    if (requirement === 'data') {
      if (data.state !== 'ready') {
        return {
          requirement,
          state: data.state === 'checking' ? 'checking' : 'missing',
        }
      }
      continue
    }

    const ready =
      requirement === 'training-data'
        ? artifacts.datasets.some((dataset) => dataset.row_count > 0)
        : artifacts.runs.some((run) => run.status === 'completed')
    if (!ready) {
      return {
        requirement,
        state: !artifacts.checked ? 'checking' : artifacts.error ? 'error' : 'missing',
      }
    }
  }
  return null
}
