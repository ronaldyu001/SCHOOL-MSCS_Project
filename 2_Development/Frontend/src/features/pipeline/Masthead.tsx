import { Icon, Panel } from '@/components/ui'
import { LADDER } from '@/app/routes'
import styles from './Masthead.module.css'

/**
 * What the project holds fixed. Stated up front because it is the discipline
 * the whole measurement rests on: if anything here moved between runs, a
 * difference in recall could not be attributed to the query.
 */
const INVARIANTS = [
  { name: 'Memory construction', value: 'one memory per turn' },
  { name: 'Encoder', value: 'bge-base-en-v1.5, pinned' },
  { name: 'Answer model', value: 'frozen' },
  { name: 'Retrieval depth', value: 'fixed' },
  { name: 'Token budget', value: 'fixed, swept' },
  { name: 'Training corpus', value: 'LoCoMo' },
]

export function Masthead() {
  return (
    <Panel as="header" className={styles.masthead}>
      <div className={styles.intro}>
        <span className={styles.eyebrow}>CSCI 6970 · MS Project · Fall 2026</span>
        <h1>Training memory query rewriters without evidence labels</h1>
        <p className={styles.lede}>
          A memory system searches with the user's message as written, which is often a
          poor search key. A trained rewriter fixes that, but the strongest published
          method learns from human-annotated evidence — data a deployed assistant does
          not have. This project builds the reward{' '}
          <strong>out of the conversation itself</strong> and measures what that costs.
        </p>
      </div>

      <aside className={styles.frozen}>
        <p className={styles.frozenHead}>
          <Icon name="lock" size={12} />
          Frozen harness
        </p>
        <ul className={styles.invariants}>
          {INVARIANTS.map((item) => (
            <li key={item.name} className={styles.invariant}>
              <span className={styles.invariantName}>{item.name}</span>
              <span className={styles.invariantValue}>{item.value}</span>
            </li>
          ))}
        </ul>
        <p className={styles.frozenNote}>
          The query is the only thing that changes. Any difference in retrieval came
          from the rewrite.
        </p>
      </aside>

      <ol className={styles.ladder}>
        {LADDER.map((rung) => {
          const contribution = rung.step >= 2 && rung.step <= 4
          return (
            <li
              key={rung.step}
              className={[
                styles.rung,
                contribution && styles.contribution,
                rung.step === 5 && styles.ceiling,
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className={styles.rungStep}>
                {rung.step}
                {contribution ? ' · contribution' : ''}
              </span>
              <span className={styles.rungName}>{rung.name}</span>
              <span className={styles.rungNote}>{rung.note}</span>
            </li>
          )
        })}
      </ol>

      <ul className={styles.ladderLegend}>
        <li className={styles.legendItem}>
          <span
            className={`${styles.legendSwatch} ${styles.legendSwatchAccent}`}
            aria-hidden="true"
          />
          Trained without labels — this project's contribution
        </li>
        <li className={styles.legendItem}>
          <span className={styles.legendSwatch} aria-hidden="true" />
          Reference points it is measured against
        </li>
      </ul>
    </Panel>
  )
}
