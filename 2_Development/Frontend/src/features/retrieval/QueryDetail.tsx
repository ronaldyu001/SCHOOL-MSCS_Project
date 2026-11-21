import {
  Button,
  Callout,
  Disclosure,
  MetricBar,
  OptionChips,
  Panel,
  PanelBody,
  PanelHeader,
  PanelSection,
  Stat,
  StatGrid,
} from '@/components/ui'
import { count, percent } from '@/lib/format'
import type { Retrieval } from './useRetrieval'
import styles from './QueryDetail.module.css'

/** The selected query in full: what fit, what came back, what the reader said. */
export function QueryDetail({ retrieval }: { retrieval: Retrieval }) {
  const { result, focused, budget, answer } = retrieval
  if (!result || !focused || !budget) return null

  const scored = result.expected_turn_ids.length > 0
  const expected = new Set(result.expected_turn_ids)
  const inBudget = new Set(budget.source_turn_ids)
  const answered = answer.status === 'done' ? answer.result : null
  const multiple = focused.budgets.length > 1

  return (
    <Panel>
      <PanelHeader
        titleAs="h3"
        eyebrow={focused.index === 0 ? 'As written' : `Rewrite ${focused.index}`}
        title={focused.query}
      />

      {multiple ? (
        <PanelSection>
          <OptionChips
            legend="Context size"
            options={focused.budgets.map((entry) => ({
              value: String(entry.token_budget),
              label: `${entry.token_budget}`,
            }))}
            selected={String(budget.token_budget)}
            onPick={(value) => retrieval.setFocusBudget(Number(value))}
          />
          <MetricBar
            caption={scored ? 'How much was found at each size' : 'Memories that fit'}
            max={
              scored
                ? 1
                : Math.max(...focused.budgets.map((entry) => entry.included_count), 1)
            }
            rows={focused.budgets.map((entry) => ({
              key: String(entry.token_budget),
              label: `${entry.token_budget}`,
              value: scored ? (entry.evidence_recall ?? 0) : entry.included_count,
              readout: scored
                ? percent(entry.evidence_recall ?? 0, 1)
                : `${entry.included_count} memories`,
              emphasis: entry.token_budget === budget.token_budget,
            }))}
          />
        </PanelSection>
      ) : null}

      <PanelBody>
        <StatGrid>
          {scored ? (
            <Stat
              label="Found"
              value={percent(budget.evidence_recall ?? 0, 1)}
              hint="Of the turns that answer this question."
              accent
            />
          ) : null}
          <Stat
            label="Memories used"
            value={`${count(budget.included_count)} of ${count(focused.match_count)}`}
            text
          />
          <Stat
            label="Space used"
            value={`${count(budget.tokens_used)} / ${count(budget.token_budget)}`}
            text
          />
        </StatGrid>

        <div className={styles.contextHead}>
          <h4 className={styles.subhead}>What the reader sees</h4>
          <Button
            size="sm"
            icon="arrow"
            busy={answer.status === 'running'}
            disabled={retrieval.busy || budget.context === ''}
            onClick={() => void retrieval.runAnswer(budget.context)}
          >
            Answer from this
          </Button>
        </div>

        {budget.context === '' ? (
          <Callout tone="warn" title="Nothing fit">
            <p>
              Even the top memory is longer than {count(budget.token_budget)} tokens.
              Try a bigger context size.
            </p>
          </Callout>
        ) : (
          <pre className={styles.context}>{budget.context}</pre>
        )}

        {answer.status === 'failed' ? (
          <Callout tone="error" title="Couldn't get an answer" role="alert">
            <p>{answer.error}</p>
          </Callout>
        ) : null}

        {answered ? (
          <Callout
            tone={answered.answer === null || answered.abstained ? 'warn' : 'done'}
            title={
              answered.answer === null
                ? 'No answer'
                : answered.abstained
                  ? "The reader said it couldn't tell"
                  : 'Answer'
            }
          >
            {answered.answer ? (
              <p className={styles.answer}>{answered.answer}</p>
            ) : null}
            {answered.answer === null ? (
              <p>The context was too long for the model to read.</p>
            ) : null}
          </Callout>
        ) : null}

        <Disclosure
          summary="All memories that came back"
          count={focused.matches.length}
        >
          <ol className={styles.memories}>
            {focused.matches.map((match) => {
              const packed = match.source_turn_ids.some((id) => inBudget.has(id))
              const hit = match.source_turn_ids.some((id) => expected.has(id))
              return (
                <li
                  key={match.memory_id}
                  className={[styles.memory, packed && styles.packed, hit && styles.hit]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className={styles.memoryHead}>
                    <span className={styles.rank}>#{match.rank}</span>
                    <span className={styles.flags}>
                      {packed ? <span className={styles.flagPacked}>used</span> : null}
                      {hit ? <span className={styles.flagHit}>wanted</span> : null}
                    </span>
                  </div>
                  <p className={styles.memoryText}>{match.text}</p>
                </li>
              )
            })}
          </ol>
        </Disclosure>
      </PanelBody>
    </Panel>
  )
}
