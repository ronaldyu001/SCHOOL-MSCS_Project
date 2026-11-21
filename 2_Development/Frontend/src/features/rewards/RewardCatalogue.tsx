import { Panel, PanelBody, PanelHeader } from '@/components/ui'
import type { RewardDef } from '@/lib/api'
import styles from './RewardCatalogue.module.css'

/** The four scorers, one line each. */
export function RewardCatalogue({ catalogue }: { catalogue: RewardDef[] }) {
  if (catalogue.length === 0) return null

  return (
    <Panel>
      <PanelHeader
        title="The four scorers"
        description="Three work without any answer key. R0 uses the dataset's own answers, so it shows what a perfect score would look like."
      />
      <PanelBody>
        <ul className={styles.cards}>
          {catalogue.map((reward) => (
            <li
              key={reward.id}
              className={[styles.card, !reward.label_free && styles.ceiling]
                .filter(Boolean)
                .join(' ')}
            >
              <div className={styles.cardHead}>
                <span className={styles.id}>{reward.id.toUpperCase()}</span>
                <span className={reward.label_free ? styles.tagGood : styles.tagWarn}>
                  {reward.label_free ? 'no answer key' : 'uses the answer key'}
                </span>
              </div>
              <h3 className={styles.title}>{reward.title}</h3>
              <p className={styles.summary}>{reward.summary}</p>
            </li>
          ))}
        </ul>
      </PanelBody>
    </Panel>
  )
}
