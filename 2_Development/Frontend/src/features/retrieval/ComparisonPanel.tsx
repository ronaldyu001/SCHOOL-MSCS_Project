import { DataTable, Panel, PanelBody, PanelHeader } from '@/components/ui'
import { count, percent } from '@/lib/format'
import type { SearchResponse } from '@/lib/api'
import styles from './ComparisonPanel.module.css'

type ComparisonPanelProps = {
  result: SearchResponse
  focus: number
  onFocus: (index: number) => void
}

/** One row per query, at the largest context size tried. */
export function ComparisonPanel({ result, focus, onFocus }: ComparisonPanelProps) {
  const widest = result.token_budgets[result.token_budgets.length - 1]
  const scored = result.expected_turn_ids.length > 0

  if (result.results.length < 2) return null

  const rows = result.results.map((entry) => {
    const budget = entry.budgets[entry.budgets.length - 1]
    const recall = budget.evidence_recall
    return {
      key: String(entry.index),
      header: (
        <button
          type="button"
          className={`${styles.pick} ${entry.index === focus ? styles.pickOn : ''}`}
          aria-pressed={entry.index === focus}
          onClick={() => onFocus(entry.index)}
        >
          <span className={styles.pickRole}>
            {entry.index === 0 ? 'as written' : `rewrite ${entry.index}`}
            {entry.index === result.selected_index ? ' · best' : ''}
          </span>
          <span className={styles.pickQuery}>{entry.query}</span>
        </button>
      ),
      highlight: entry.index === result.selected_index,
      cells: [
        scored ? (recall === null ? '—' : percent(recall, 1)) : '—',
        count(budget.included_count),
        entry.first_expected_rank === null
          ? scored
            ? 'missed'
            : '—'
          : `#${entry.first_expected_rank}`,
      ],
    }
  })

  return (
    <Panel>
      <PanelHeader
        titleAs="h3"
        title="Which wording worked best"
        description={
          scored
            ? result.selection_note
            : `Compared at ${count(widest)} tokens. Add expected turns to score them.`
        }
      />
      <PanelBody>
        <DataTable
          caption={`Each query at the ${count(widest)}-token context size`}
          rowHeader="Query"
          columns={['Found', 'Memories used', 'First hit']}
          rows={rows}
        />
      </PanelBody>
    </Panel>
  )
}
