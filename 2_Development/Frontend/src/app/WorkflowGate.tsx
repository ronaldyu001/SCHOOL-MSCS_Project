import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Button, Callout } from '@/components/ui'
import { useShell } from './shell-context'
import { REQUIREMENT_LABEL, REQUIREMENT_SOURCE, type RouteDef } from './routes'
import { nextRequirement } from './workflow'
import styles from './PlannedPage.module.css'

export function WorkflowGate({
  route,
  children,
}: {
  route: RouteDef
  children: ReactNode
}) {
  const { data, artifacts } = useShell()
  const prerequisite = nextRequirement(route, data, artifacts)
  if (!prerequisite) return <>{children}</>

  const { requirement, state } = prerequisite
  const source = REQUIREMENT_SOURCE[requirement]
  return (
    <div className={styles.page}>
      <h1>{route.title}</h1>
      {state === 'checking' ? (
        <Callout tone="info" role="status">
          Checking prerequisites…
        </Callout>
      ) : state === 'error' ? (
        <Callout tone="error" title="Couldn’t check saved artifacts">
          <p>{artifacts.error}</p>
          <Button size="sm" onClick={() => void artifacts.refresh()}>
            Try again
          </Button>
        </Callout>
      ) : (
        <Callout tone="info" title={`Complete ${source.label} first`}>
          <p>{REQUIREMENT_LABEL[requirement]}</p>
          <Link to={source.path}>Open {source.label}</Link>
        </Callout>
      )}
    </div>
  )
}
