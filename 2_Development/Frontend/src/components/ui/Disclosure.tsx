import type { ReactNode } from 'react'
import { Icon } from './Icon'
import styles from './Disclosure.module.css'

type DisclosureProps = {
  summary: string
  /** Shown right-aligned in the summary, e.g. the number of hidden rows. */
  count?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}

/** Built on <details> so expand/collapse, keyboard support and in-page find
 *  all come from the platform rather than from state we have to maintain. */
export function Disclosure({ summary, count, defaultOpen, children }: DisclosureProps) {
  return (
    <details className={styles.details} open={defaultOpen}>
      <summary className={styles.summary}>
        <Icon name="chevron" size={13} className={styles.chevron} />
        {summary}
        {count !== undefined ? <span className={styles.count}>{count}</span> : null}
      </summary>
      <div className={styles.content}>{children}</div>
    </details>
  )
}

export function ChipList({ items, label }: { items: string[]; label: string }) {
  return (
    <ul className={styles.chips} aria-label={label}>
      {items.map((item) => (
        <li key={item} className={styles.chip}>
          {item}
        </li>
      ))}
    </ul>
  )
}
