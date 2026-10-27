import { Icon, type PhaseStatus } from '@/components/ui'
import styles from './PipelineRail.module.css'

const STATUS_WORD: Record<PhaseStatus, string> = {
  blocked: 'Blocked',
  idle: 'Ready',
  running: 'Running',
  done: 'Complete',
  failed: 'Failed',
}

export type RailStep = {
  id: string
  title: string
  status: PhaseStatus
}

/**
 * Phase order and progress, as in-page anchors. Plain links rather than scroll
 * handlers, so the browser owns the jump, the focus move and the back button.
 */
export function PipelineRail({ steps }: { steps: RailStep[] }) {
  return (
    <nav className={styles.rail} aria-label="Pipeline phases">
      <span className={styles.railLabel}>Pipeline</span>
      {steps.map((step, index) => (
        <a
          key={step.id}
          href={`#${step.id}`}
          className={`${styles.step} ${styles[step.status]}`}
        >
          <span className={styles.marker} aria-hidden="true">
            {step.status === 'done' ? (
              <Icon name="check" size={11} strokeWidth={2.5} />
            ) : step.status === 'running' ? (
              <Icon name="spinner" size={11} className={styles.spin} />
            ) : step.status === 'failed' ? (
              <Icon name="alert" size={11} />
            ) : (
              index + 1
            )}
          </span>
          <span className={styles.text}>
            <span className={styles.title}>{step.title}</span>
            <span className={styles.status}>{STATUS_WORD[step.status]}</span>
          </span>
          <span className="sr-only">— {STATUS_WORD[step.status]}</span>
        </a>
      ))}
    </nav>
  )
}
