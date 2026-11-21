import styles from './MetricBar.module.css'

export type MetricRow = {
  key: string
  /** Row label, e.g. a budget size or a query number. */
  label: string
  /** Bar length, as a fraction of `max`. */
  value: number
  /** What the row actually reports, in words. Always shown as text. */
  readout: string
  /** Draw this row as the selected one. */
  emphasis?: boolean
  /** Draw the bar as absent rather than zero-length. */
  missing?: boolean
}

type MetricBarProps = {
  caption: string
  rows: MetricRow[]
  /** Denominator for the bar lengths. Defaults to the largest value present. */
  max?: number
  unit?: string
}

/**
 * A small set of labelled magnitudes.
 *
 * The bars are decorative: every number is printed as text in the same row, so
 * nothing here depends on reading a width or a colour. Used for budget curves
 * and per-query scores, where a chart library would be more dependency than the
 * four-to-eight rows justify.
 */
export function MetricBar({ caption, rows, max, unit }: MetricBarProps) {
  const ceiling = max ?? Math.max(...rows.map((row) => row.value), 0)
  const denominator = ceiling > 0 ? ceiling : 1

  return (
    <figure className={styles.wrap}>
      <figcaption className={styles.caption}>{caption}</figcaption>
      <ul className={styles.rows}>
        {rows.map((row) => (
          <li
            key={row.key}
            className={`${styles.row} ${row.emphasis ? styles.emphasis : ''}`}
          >
            <span className={styles.label}>{row.label}</span>
            <span className={styles.track} aria-hidden="true">
              {row.missing ? null : (
                <span
                  className={styles.fill}
                  style={{
                    inlineSize: `${Math.min(100, Math.max(0, (row.value / denominator) * 100))}%`,
                  }}
                />
              )}
            </span>
            <span className={styles.readout}>
              {row.readout}
              {unit ? <span className={styles.unit}> {unit}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  )
}
