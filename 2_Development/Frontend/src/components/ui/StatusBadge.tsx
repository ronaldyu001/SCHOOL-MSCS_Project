import { Icon, type IconName } from './Icon'
import styles from './StatusBadge.module.css'

export type PhaseStatus = 'blocked' | 'idle' | 'running' | 'done' | 'failed'

/* Status is carried by three redundant channels — colour, glyph and word — so it
 * survives a colour-blind reader, a greyscale print and a screen reader. */
const PRESETS: Record<PhaseStatus, { icon: IconName; label: string }> = {
  blocked: { icon: 'lock', label: 'Blocked' },
  idle: { icon: 'dot', label: 'Ready' },
  running: { icon: 'spinner', label: 'Running' },
  done: { icon: 'check', label: 'Complete' },
  failed: { icon: 'alert', label: 'Failed' },
}

type StatusBadgeProps = {
  status: PhaseStatus
  label?: string
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const preset = PRESETS[status]
  return (
    <span className={`${styles.badge} ${styles[status]}`}>
      <Icon
        name={preset.icon}
        size={12}
        strokeWidth={preset.icon === 'dot' ? 3 : 2}
        className={status === 'running' ? styles.spin : undefined}
      />
      {label ?? preset.label}
    </span>
  )
}
