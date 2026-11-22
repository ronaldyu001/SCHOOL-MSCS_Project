import { Link } from 'react-router'
import { Icon } from '@/components/ui'
import { count } from '@/lib/format'
import type { DataReadiness } from './data-readiness'
import { StepRail } from './StepRail'
import styles from './DataBanner.module.css'

/**
 * One line of chrome, directly under the navigation, saying where the data
 * stands.
 *
 * It is part of the shell rather than any page, which is the whole point: the
 * data is what Search, Training data and Results all hang off, so its state
 * should not be something you discover by opening the right tab. It stays put
 * while you move between them, so switching tabs during a long index never
 * looks like it interrupted something.
 *
 * It shows itself only when there is something to say. Nothing appears while
 * the first check is in flight — that resolves in a moment, and a band that
 * blinks in and out of the chrome would read as a fault of its own.
 */
export function DataBanner({
  data,
  onSetup,
}: {
  data: DataReadiness
  onSetup: boolean
}) {
  const { progress, state } = data
  const building = state === 'building' || data.rebuilding
  const stopped = state === 'empty' && progress.failed !== null

  if (state === 'checking') return null
  if (state === 'ready' && !data.rebuilding) return null
  // Setup already shows all of this, a few pixels lower and in more detail.
  if (onSetup) return null

  const tone = building ? styles.busy : stopped ? styles.stopped : styles.blocked
  const step =
    progress.position === null
      ? null
      : `step ${progress.position} of ${progress.total} · ${progress.doing}`

  return (
    <div className={`${styles.banner} ${tone}`} role="status">
      <div className={styles.inner}>
        <Icon
          name={building ? 'spinner' : stopped ? 'alert' : 'lock'}
          size={14}
          className={building ? styles.spin : undefined}
        />

        <p className={styles.text}>
          {building ? (
            <>
              <strong>
                {data.rebuilding ? 'Setting the data up again' : 'Setting up the data'}
              </strong>
              {step ? <span className={styles.detail}>{step}</span> : null}
              <span className={styles.aside}>
                {data.rebuilding
                  ? `The ${count(data.indexedMemories)} memories already indexed still work.`
                  : 'Search and Training data start working on their own when it finishes.'}
              </span>
            </>
          ) : stopped ? (
            <>
              <strong>Setup stopped at “{progress.failed}”</strong>
              <span className={styles.aside}>
                Nothing is indexed, so Search and Training data have nothing to work
                with.
              </span>
            </>
          ) : (
            <>
              <strong>No data loaded yet</strong>
              <span className={styles.aside}>
                Search and Training data both need the conversations indexed first.
              </span>
            </>
          )}
        </p>

        {building ? (
          <StepRail
            done={progress.done}
            position={progress.position}
            className={styles.rail}
          />
        ) : null}

        <Link to="/setup" className={styles.action}>
          {building ? 'Watch it' : stopped ? 'Open setup' : 'Set up the data'}
          <Icon name="arrow" size={13} />
        </Link>
      </div>
    </div>
  )
}
