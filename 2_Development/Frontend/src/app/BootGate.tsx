import type { ReactNode } from 'react'
import { BrandMark, Button, Callout, Icon, StatusBadge } from '@/components/ui'
import { duration } from '@/lib/format'
import type { BootStep, BootStepStatus } from '@/lib/api'
import { useBoot } from './useBoot'
import styles from './BootGate.module.css'

const STATUS: Record<BootStepStatus, 'blocked' | 'running' | 'done' | 'failed'> = {
  pending: 'blocked',
  active: 'running',
  done: 'done',
  failed: 'failed',
}

const STATUS_WORD: Record<BootStepStatus, string> = {
  pending: 'Waiting',
  active: 'Working',
  done: 'Ready',
  failed: 'Failed',
}

function Step({ step }: { step: BootStep }) {
  return (
    <li className={`${styles.step} ${styles[step.status]}`}>
      <span className={styles.stepHead}>
        <StatusBadge status={STATUS[step.status]} label={STATUS_WORD[step.status]} />
        <span className={styles.stepLabel}>{step.label}</span>
      </span>
      <span className={styles.stepDetail}>{step.detail}</span>
    </li>
  )
}

/**
 * Holds the console back until the stack behind it can actually serve.
 *
 * The desktop window opens the moment Vite is serving, which on a cold start
 * is many minutes before Compose has built an image and started a container.
 * Letting the app render into that gap produces a console whose every button
 * fails for a reason it cannot explain — so the app does not mount at all
 * until the API reports itself ready, and this screen says what is happening
 * in the meantime.
 *
 * It never times out on its own. A first desktop build downloads PyTorch, and
 * treating that as a failure would be wrong. What it does offer, once waiting
 * has clearly stopped being normal, is a way through: somebody running the
 * frontend on its own should not be locked out of their own UI.
 */
export function BootGate({ children }: { children: ReactNode }) {
  const boot = useBoot()

  if (boot.ready) return <>{children}</>

  const containerFeed = boot.launcher !== null

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <header className={styles.brand}>
          <BrandMark size={26} className={styles.mark} />
          <span className={styles.brandText}>
            <span className={styles.brandName}>Memory Query Rewriter</span>
            <span className={styles.brandMeta}>CSCI 6970 · MS Project</span>
          </span>
        </header>

        <div>
          <h1 className={styles.title}>
            {boot.error ? "Couldn't start" : 'Starting up'}
          </h1>
          <p className={styles.lede}>
            {boot.error
              ? 'Something it needs did not come up.'
              : 'Waiting for the backend. The first run builds it, which takes a while.'}
          </p>
        </div>

        <ol className={styles.steps}>
          {boot.steps.map((step) => (
            <Step key={step.id} step={step} />
          ))}
        </ol>

        {!containerFeed && !boot.error ? (
          <p className={styles.note}>
            <Icon name="dot" size={11} strokeWidth={3} />
            Only checking the backend. Start it with the desktop launcher to see the
            container steps too.
          </p>
        ) : null}

        {boot.error ? (
          <Callout tone="error" title="Startup failed" role="alert">
            <p>{boot.error}</p>
            <p className={styles.hint}>
              The full output is in the terminal you launched from. Fix it there and hit
              Check again.
            </p>
            {boot.staleBackend ? (
              <p className={styles.hint}>
                An older backend is still running, so the console would work. It just
                won't be the version you were trying to start.
              </p>
            ) : null}
          </Callout>
        ) : null}

        <footer className={styles.footer}>
          <span className={styles.elapsed} role="status">
            <Icon
              name={boot.error ? 'alert' : 'spinner'}
              size={13}
              className={boot.error ? undefined : styles.spin}
            />
            {boot.error ? 'Stopped' : 'Waiting'} · {duration(boot.elapsedMs)}
          </span>
          <span className={styles.actions}>
            <Button size="sm" icon="refresh" onClick={boot.retry}>
              Check again
            </Button>
            {boot.canOverride ? (
              <Button size="sm" variant="ghost" onClick={boot.override}>
                Open the console anyway
              </Button>
            ) : null}
          </span>
        </footer>

        {boot.canOverride ? (
          <p className={styles.hint}>Nothing will work until the backend is up.</p>
        ) : null}
      </div>
    </div>
  )
}
