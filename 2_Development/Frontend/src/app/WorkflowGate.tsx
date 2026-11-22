import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Button, Icon } from '@/components/ui'
import type { Artifacts } from '@/features/artifacts/useArtifacts'
import type { DataReadiness } from './data-readiness'
import {
  REQUIREMENT_LABEL,
  REQUIREMENT_NOUN,
  REQUIREMENT_SOURCE,
  type RouteDef,
} from './routes'
import { useShell } from './shell-context'
import { StepRail } from './StepRail'
import { nextRequirement, type Prerequisite } from './workflow'
import styles from './WorkflowGate.module.css'

function toneFor(state: Prerequisite['state']) {
  if (state === 'checking' || state === 'building') return 'nodeBusy'
  if (state === 'error') return 'nodeStopped'
  return 'nodeBlocked'
}

/** The short status under the dependency's name, in the chain line. */
function wordFor({ requirement, state }: Prerequisite, data: DataReadiness) {
  if (state === 'checking') return 'checking…'
  if (state === 'error') return 'unknown'
  if (state === 'building') {
    return requirement === 'data' && data.progress.position !== null
      ? `step ${data.progress.position} of ${data.progress.total}`
      : 'in progress'
  }
  return 'not ready'
}

function headingFor({ requirement, state }: Prerequisite, route: RouteDef) {
  if (state === 'checking') return 'Checking what is ready'
  if (state === 'error') return 'Could not check what is saved'
  if (state === 'building') return `${REQUIREMENT_NOUN[requirement]} is being made now`
  return `${route.title} needs one more step`
}

function explainFor(
  { requirement, state }: Prerequisite,
  data: DataReadiness,
  artifacts: Artifacts,
) {
  if (state === 'checking') return 'Asking the backend what this session already has.'
  if (state === 'error') return artifacts.error ?? 'The backend did not answer.'
  if (state === 'building') {
    return requirement === 'data'
      ? `${data.progress.doing ?? 'Working'}. This page starts working by itself when it finishes — nothing here is broken, it is waiting.`
      : `${artifacts.active?.name ?? 'A run'} is still training. This page opens on its own once it finishes.`
  }
  return REQUIREMENT_LABEL[requirement]
}

/**
 * Stands in for a page that has nothing to work with yet.
 *
 * One gate for the whole guided flow, driven by each route's `requires`. There
 * were two of these — a page-level one for the index and a router-level one
 * for saved artifacts — so the same situation looked like two different
 * problems depending on which tab you opened. This keeps the page-level
 * presentation, the dependency as one line followed by what to do about it,
 * and applies it to every gated route from the router. A new step in the flow
 * is now gated by declaring `requires`, not by remembering to wrap the page.
 *
 * The route's own title and lede stay above the card, so a tab opened too
 * early still looks like the tab you asked for.
 */
export function WorkflowGate({
  route,
  children,
}: {
  route: RouteDef
  children: ReactNode
}) {
  const { data, artifacts } = useShell()
  const navigate = useNavigate()
  const prerequisite = nextRequirement(route, data, artifacts)

  if (!prerequisite) return <>{children}</>

  const { requirement, state } = prerequisite
  const source = REQUIREMENT_SOURCE[requirement]
  const busy = state === 'checking' || state === 'building'

  return (
    <div className={styles.page}>
      <div>
        <h1>{route.title}</h1>
        <p className={styles.lede}>{route.summary}</p>
      </div>

      <section
        className={`${styles.gate} ${state === 'checking' ? styles.quiet : ''}`}
        aria-live="polite"
      >
        <p className={styles.chain}>
          <span className={`${styles.node} ${styles[toneFor(state)]}`}>
            <Icon
              name={busy ? 'spinner' : state === 'error' ? 'alert' : 'lock'}
              size={13}
              className={busy ? styles.spin : undefined}
            />
            <span className={styles.nodeName}>{REQUIREMENT_NOUN[requirement]}</span>
            <span className={styles.nodeWord}>{wordFor(prerequisite, data)}</span>
          </span>

          <Icon name="arrow" size={14} className={styles.arrow} />

          <span className={styles.node}>
            <span className={styles.nodeName}>{route.label}</span>
            <span className={styles.nodeWord}>waiting on it</span>
          </span>
        </p>

        {requirement === 'data' && state === 'building' ? (
          <StepRail done={data.progress.done} position={data.progress.position} />
        ) : null}

        <h2 className={styles.heading}>{headingFor(prerequisite, route)}</h2>
        <p className={styles.explain}>{explainFor(prerequisite, data, artifacts)}</p>

        {state === 'checking' ? null : state === 'error' ? (
          <Button
            variant="primary"
            icon="refresh"
            onClick={() => void artifacts.refresh()}
          >
            Try again
          </Button>
        ) : (
          <Button
            variant={state === 'building' ? 'secondary' : 'primary'}
            icon="arrow"
            onClick={() => void navigate(source.path)}
          >
            {state === 'building' ? `Watch ${source.label}` : `Open ${source.label}`}
          </Button>
        )}
      </section>
    </div>
  )
}
