import type { HealthState } from '@/lib/useHealth'
import styles from './HealthIndicator.module.css'

const LABELS: Record<HealthState, string> = {
  checking: 'Checking',
  online: 'API up',
  offline: 'API down',
}

type HealthIndicatorProps = {
  state: HealthState
  checkedAt: Date | null
  onRefresh: () => void
}

export function HealthIndicator({ state, checkedAt, onRefresh }: HealthIndicatorProps) {
  const stamp = checkedAt?.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  return (
    <button
      type="button"
      className={`${styles.indicator} ${styles[state]}`}
      onClick={onRefresh}
      title={stamp ? `Last checked ${stamp}. Click to re-check.` : 'Checking backend…'}
    >
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.label}>{LABELS[state]}</span>
      <span className="sr-only">
        {`Backend status: ${LABELS[state]}${stamp ? `, checked at ${stamp}` : ''}. Activate to re-check.`}
      </span>
    </button>
  )
}
