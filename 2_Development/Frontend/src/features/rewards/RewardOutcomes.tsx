import type { ReactNode } from 'react'
import {
  Callout,
  DataTable,
  Disclosure,
  MetricBar,
  Panel,
  PanelBody,
  PanelHeader,
  Stat,
  StatGrid,
} from '@/components/ui'
import { count, percent } from '@/lib/format'
import type { RewardDef, RewardResult } from '@/lib/api'
import styles from './RewardOutcomes.module.css'

type RewardOutcomesProps = {
  result: RewardResult
  definition?: RewardDef
  aside?: ReactNode
}

function reasonLabel(reason: string) {
  return reason.replace(/_/g, ' ')
}

/** What happened to each question this scorer saw. */
export function RewardOutcomes({ result, definition, aside }: RewardOutcomesProps) {
  const skipped = Object.entries(result.skipped).sort((a, b) => b[1] - a[1])

  return (
    <Panel>
      <PanelHeader
        titleAs="h3"
        eyebrow={result.reward.toUpperCase()}
        title={definition?.title ?? result.reward.toUpperCase()}
        aside={aside}
      />

      <PanelBody>
        <StatGrid>
          <Stat
            label="Rewrites kept"
            value={count(result.kept)}
            hint={`Out of ${count(result.attempted)} questions tried.`}
            accent
          />
          <Stat label="Thrown out" value={count(result.attempted - result.kept)} />
          {result.kept_all_one_ties ? (
            <Stat
              label="Kept from all-one ties"
              value={count(result.kept_all_one_ties)}
            />
          ) : null}
        </StatGrid>

        {result.attempted === 0 ? (
          <Callout tone="warn" title="Nothing to score">
            <p>
              This scorer found no questions it could use in the partition you picked.
            </p>
          </Callout>
        ) : null}

        {skipped.length > 0 ? (
          <MetricBar
            caption="Why questions were thrown out"
            max={result.attempted}
            rows={skipped.map(([reason, total]) => ({
              key: reason,
              label: reasonLabel(reason),
              value: total,
              readout: `${count(total)} · ${percent(total, result.attempted)}`,
            }))}
          />
        ) : null}

        {result.examples.length > 0 ? (
          <Disclosure summary="Rewrites it kept" count={result.examples.length}>
            <ul className={styles.examples}>
              {result.examples.map((example, index) => (
                <li key={index} className={styles.example}>
                  {example.completion}
                </li>
              ))}
            </ul>
          </Disclosure>
        ) : null}

        {result.outcomes.length > 0 ? (
          <Disclosure summary="Details per question" count={result.outcomes.length}>
            <DataTable
              caption={`Every question ${result.reward.toUpperCase()} tried`}
              rowHeader="Question"
              columns={['Rewrites', 'Score', 'Result']}
              rows={result.outcomes.map((outcome, index) => ({
                key: `${outcome.input_id}-${index}`,
                header: <code className={styles.id}>{outcome.input_id}</code>,
                highlight: outcome.skip_reason === null,
                cells: [
                  outcome.candidate_count === 0 ? '—' : count(outcome.candidate_count),
                  (outcome.winning_score ?? outcome.tied_score)?.toFixed(3) ?? '—',
                  outcome.skip_reason ? (
                    <span className={styles.skip}>
                      {reasonLabel(outcome.skip_reason)}
                    </span>
                  ) : (
                    <span className={styles.keptFlag}>
                      {outcome.kept_all_one_tie ? 'kept from all-one tie' : 'kept'}
                    </span>
                  ),
                ],
              }))}
            />
          </Disclosure>
        ) : null}
      </PanelBody>
    </Panel>
  )
}
