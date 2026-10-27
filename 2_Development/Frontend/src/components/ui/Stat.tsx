import type { ReactNode } from 'react'
import styles from './Stat.module.css'

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>
}

type StatProps = {
  label: string
  value: ReactNode
  unit?: string
  hint?: ReactNode
  /** Render the value at body size, for identifiers and model names. */
  text?: boolean
  accent?: boolean
  /** Set when the well sits on a sunken band, so it steps up instead of down. */
  onSunken?: boolean
}

export function Stat({ label, value, unit, hint, text, accent, onSunken }: StatProps) {
  return (
    <div
      className={[styles.stat, onSunken && styles.onSunken, accent && styles.accent]
        .filter(Boolean)
        .join(' ')}
    >
      <span className={styles.label}>{label}</span>
      <span className={styles.valueRow}>
        <span className={`${styles.value} ${text ? styles.textValue : ''}`}>
          {value}
        </span>
        {unit ? <span className={styles.unit}>{unit}</span> : null}
      </span>
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </div>
  )
}
