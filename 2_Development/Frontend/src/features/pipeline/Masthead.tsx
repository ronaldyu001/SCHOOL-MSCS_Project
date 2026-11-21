import { Panel } from '@/components/ui'
import styles from './Masthead.module.css'

/**
 * The project in a few lines.
 *
 * It used to list the frozen settings and the six-step evaluation ladder. Both
 * are real, but neither helps anyone use the page, so they are not here.
 */
export function Masthead() {
  return (
    <Panel as="header" className={styles.masthead}>
      <span className={styles.eyebrow}>CSCI 6970 · MS Project · Fall 2026</span>
      <h1>Training memory query rewriters without evidence labels</h1>
      <p className={styles.lede}>
        Memory systems search with your message exactly as you typed it, which is often
        a poor search key. Rewriting it helps, but the best published method learns from
        hand-labelled examples that a real assistant never has. This project builds the
        training signal out of the conversation itself.
      </p>
    </Panel>
  )
}
