import styles from './AllocationBar.module.css'

export type AllocationTone = 'primary' | 'secondary' | 'tertiary' | 'remainder'

export type AllocationSegment = {
  key: string
  label: string
  value: number
  tone: AllocationTone
}

type AllocationBarProps = {
  segments: AllocationSegment[]
  /** Denominator for the shares. Any shortfall is drawn as a hatched remainder. */
  total: number
  unit: string
}

/**
 * Proportional split of a fixed total. The bar itself is decorative — every
 * number in it is also in the legend as text, so nothing is conveyed by width
 * or fill alone.
 */
export function AllocationBar({ segments, total, unit }: AllocationBarProps) {
  const allocated = segments.reduce((sum, segment) => sum + segment.value, 0)
  const remainder = Math.max(0, total - allocated)
  const drawn: AllocationSegment[] =
    remainder > 0
      ? [
          ...segments,
          {
            key: '__remainder',
            label: 'Unallocated',
            value: remainder,
            tone: 'remainder',
          },
        ]
      : segments
  const denominator = Math.max(total, allocated) || 1

  return (
    <div className={styles.wrap}>
      <div className={styles.track} aria-hidden="true">
        {drawn
          .filter((segment) => segment.value > 0)
          .map((segment) => (
            <div
              key={segment.key}
              className={`${styles.segment} ${styles[segment.tone]}`}
              style={{ flexBasis: `${(segment.value / denominator) * 100}%` }}
            />
          ))}
      </div>
      <ul className={styles.legend}>
        {drawn.map((segment) => (
          <li key={segment.key} className={styles.item}>
            <span
              className={`${styles.swatch} ${styles[segment.tone]}`}
              aria-hidden="true"
            />
            <span className={styles.name}>{segment.label}</span>
            <span className={styles.amount}>{segment.value}</span>
            <span className={styles.share}>
              {unit} · {Math.round((segment.value / denominator) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
