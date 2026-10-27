import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import styles from './CopyValue.module.css'

type CopyValueProps = {
  value: string
  /** What the value is, for the copy button's accessible name. */
  label: string
}

/**
 * A handle the user is expected to paste into curl or a notebook. The id stays
 * fully selectable, and the copy result is announced rather than only shown as
 * a glyph swap.
 */
export function CopyValue({ value, label }: CopyValueProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard access can be denied; the value is selectable either way.
    }
  }

  return (
    <span className={styles.wrap}>
      <span className={styles.value}>{value}</span>
      <button
        type="button"
        className={`${styles.copy} ${copied ? styles.copied : ''}`}
        onClick={() => void copy()}
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
      >
        <Icon name={copied ? 'check' : 'copy'} size={13} />
      </button>
      <span className="sr-only" role="status">
        {copied ? `${label} copied to clipboard` : ''}
      </span>
    </span>
  )
}
