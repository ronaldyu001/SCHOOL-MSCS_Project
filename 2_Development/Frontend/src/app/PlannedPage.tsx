import { useEffect } from 'react'
import { Link } from 'react-router'
import { Panel, PanelBody, PanelHeader, StatusBadge } from '@/components/ui'
import type { RouteDef } from './routes'
import styles from './PlannedPage.module.css'

/**
 * A section that is specified but not built. It states the scope from the
 * proposal and nothing else — no placeholder charts and no sample numbers,
 * because a convincing-looking empty dashboard is worse than an honest one.
 */
export function PlannedPage({ route }: { route: RouteDef }) {
  useEffect(() => {
    document.title = `${route.title} · Memory Query Rewriter`
  }, [route.title])

  return (
    <div className={styles.page}>
      <div>
        <h1>{route.title}</h1>
        <p className={styles.lede}>{route.summary}</p>
      </div>

      <Panel>
        <PanelHeader
          eyebrow="Not built yet"
          title="Planned scope"
          description="What this section will own, taken from the project proposal."
          aside={<StatusBadge status="idle" label="Planned" />}
        />
        <PanelBody>
          <ul className={styles.scope}>
            {route.scope.map((item) => (
              <li key={item} className={styles.item}>
                <span className={styles.box} aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </PanelBody>
      </Panel>

      <p className={styles.ref}>
        Proposal reference: {route.proposalRef} · <Link to="/">Back to pipeline</Link>
      </p>
    </div>
  )
}
