import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Button, Icon } from '@/components/ui'
import type { DataReadiness } from './data-readiness'
import { StepRail } from './StepRail'
import styles from './DataGate.module.css'

type DataGateProps = {
  data: DataReadiness
  /** This tab's name, for the dependency line. */
  page: string
  /** Heading and sentence for the case where nothing has been loaded. */
  emptyHeading: string
  emptyExplain: string
  children: ReactNode
}

/**
 * Stands in for a page body that has nothing to work with yet.
 *
 * It replaces the body only — the page keeps its own heading and lede above —
 * so a tab opened too early still looks like the tab you asked for, with the
 * reason stated where the controls would have been. The dependency reads as one
 * line: what Data is doing, an arrow, and this page waiting on it. That line is
 * the same on every page that depends on the data, so clicking between tabs
 * mid-run tells you the same thing each time instead of a different story per
 * page.
 */
export function DataGate({
  data,
  page,
  emptyHeading,
  emptyExplain,
  children,
}: DataGateProps) {
  const navigate = useNavigate()

  if (data.state === 'ready') return <>{children}</>

  const { progress } = data
  const building = data.state === 'building'
  const checking = data.state === 'checking'
  const stopped = progress.failed !== null
  const busy = building || checking
  const sourceTone = busy ? 'nodeBusy' : stopped ? 'nodeStopped' : 'nodeBlocked'

  const sourceWord = checking
    ? 'checking…'
    : building
      ? `step ${progress.position ?? progress.done + 1} of ${progress.total}`
      : stopped
        ? 'stopped'
        : 'not loaded'

  const heading = checking
    ? 'Checking what is loaded'
    : building
      ? 'The data is being set up'
      : stopped
        ? `Setup stopped at “${progress.failed}”`
        : emptyHeading

  const explain = checking
    ? 'Asking the backend whether the conversations are already indexed. A moment.'
    : building
      ? `${progress.doing ?? 'Working'}. This page starts working by itself the moment indexing finishes — nothing here is broken, it is waiting.`
      : stopped
        ? 'Nothing was indexed, so there is still nothing to work with here. Setup has the error and can retry just that step.'
        : emptyExplain

  return (
    <section
      className={`${styles.gate} ${checking ? styles.quiet : ''}`}
      aria-live="polite"
    >
      <p className={styles.chain}>
        <span className={`${styles.node} ${styles[sourceTone]}`}>
          <Icon
            name={busy ? 'spinner' : stopped ? 'alert' : 'lock'}
            size={13}
            className={busy ? styles.spin : undefined}
          />
          <span className={styles.nodeName}>Data</span>
          <span className={styles.nodeWord}>{sourceWord}</span>
        </span>

        <Icon name="arrow" size={14} className={styles.arrow} />

        <span className={styles.node}>
          <span className={styles.nodeName}>{page}</span>
          <span className={styles.nodeWord}>waiting on it</span>
        </span>
      </p>

      {building ? <StepRail done={progress.done} position={progress.position} /> : null}

      <h2 className={styles.heading}>{heading}</h2>
      <p className={styles.explain}>{explain}</p>

      {checking ? null : (
        <Button
          variant={building ? 'secondary' : 'primary'}
          icon="arrow"
          onClick={() => void navigate('/setup')}
        >
          {building ? 'Watch the setup' : stopped ? 'Open setup' : 'Set up the data'}
        </Button>
      )}
    </section>
  )
}
