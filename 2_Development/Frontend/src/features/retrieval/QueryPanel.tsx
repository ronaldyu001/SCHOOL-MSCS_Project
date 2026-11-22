import {
  Button,
  Callout,
  CheckGroup,
  Disclosure,
  OptionChips,
  Panel,
  PanelBody,
  PanelHeader,
  PanelSection,
  TextAreaField,
  TextField,
  type CheckOption,
} from '@/components/ui'
import { categoryLabel } from '@/lib/format'
import {
  BUDGET_CHOICES,
  MAX_CANDIDATES,
  parseTurnIds,
  type Retrieval,
} from './useRetrieval'
import styles from './QueryPanel.module.css'

const BUDGET_OPTIONS: CheckOption<string>[] = BUDGET_CHOICES.map((budget) => ({
  value: String(budget),
  label: String(budget),
}))

/**
 * The search form.
 *
 * Only three things are needed to run a search, so only those three are on
 * screen. Everything else has a working default and lives under Options.
 */
export function QueryPanel({ retrieval }: { retrieval: Retrieval }) {
  const { settings, update, known, questions, busy } = retrieval
  const expected = parseTurnIds(settings.expectedTurnIds)
  const ready = settings.conversationId.trim() !== '' && settings.text.trim() !== ''

  return (
    <Panel>
      <PanelHeader title="Search" />

      <PanelSection>
        <div className={styles.form}>
          {known.conversationIds.length > 0 ? (
            <OptionChips
              legend="Conversation"
              options={known.conversationIds.map((id) => ({ value: id }))}
              selected={settings.conversationId}
              disabled={busy}
              onPick={(value) => update('conversationId', value)}
            />
          ) : (
            <TextField
              label="Conversation"
              value={settings.conversationId}
              spellCheck={false}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => update('conversationId', event.target.value)}
              hint="Nothing is loaded yet. Run the pipeline, or type an id you already indexed."
            />
          )}

          <TextAreaField
            label="Question"
            rows={2}
            value={settings.text}
            disabled={busy}
            placeholder="What kind of car does Evan drive?"
            onChange={(event) => update('text', event.target.value)}
          />

          {questions.length > 0 ? (
            <Disclosure
              summary="Pick a question from the dataset"
              count={questions.length}
            >
              <ul className={styles.questions}>
                {questions.slice(0, 40).map((question) => (
                  <li key={question.id}>
                    <button
                      type="button"
                      className={styles.question}
                      disabled={busy}
                      onClick={() => retrieval.pickQuestion(question)}
                    >
                      <span className={styles.questionText}>{question.question}</span>
                      <span className={styles.questionTag}>
                        {categoryLabel(question.category)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Disclosure>
          ) : null}

          <Disclosure summary="Options">
            <div className={styles.options}>
              <CheckGroup
                legend="Context sizes to try"
                options={BUDGET_OPTIONS}
                selected={settings.budgets.map(String)}
                disabled={busy}
                onToggle={(value) => {
                  const budget = Number(value)
                  const next = settings.budgets.includes(budget)
                    ? settings.budgets.filter((entry) => entry !== budget)
                    : [...settings.budgets, budget]
                  update(
                    'budgets',
                    next.sort((a, b) => a - b),
                  )
                }}
                hint="Tokens of conversation the reader gets to see."
              />

              <div className={styles.grid}>
                <TextField
                  label="Memories to pull"
                  type="number"
                  min={1}
                  max={50}
                  value={settings.topK}
                  disabled={busy}
                  onChange={(event) => update('topK', Number(event.target.value))}
                />
                <TextField
                  label="Rewrites to try"
                  type="number"
                  min={1}
                  max={MAX_CANDIDATES}
                  value={settings.candidates}
                  disabled={busy}
                  onChange={(event) => update('candidates', Number(event.target.value))}
                />
                <TextField
                  label="Variety"
                  type="number"
                  min={0}
                  max={5}
                  step={0.1}
                  value={settings.temperature}
                  disabled={busy}
                  onChange={(event) =>
                    update('temperature', Number(event.target.value))
                  }
                  hint="0 gives the same rewrite every time."
                />
                <TextField
                  label="Seed"
                  type="number"
                  value={settings.seed}
                  disabled={busy}
                  onChange={(event) => update('seed', Number(event.target.value))}
                />
              </div>

              <TextField
                label="Expected turns"
                value={settings.expectedTurnIds}
                spellCheck={false}
                autoComplete="off"
                disabled={busy}
                onChange={(event) => update('expectedTurnIds', event.target.value)}
                hint={
                  expected.length > 0
                    ? `Scoring against ${expected.length} turn${expected.length === 1 ? '' : 's'}.`
                    : 'Picking a dataset question fills this in. Without it you still see what came back, just not whether it was right.'
                }
              />
            </div>
          </Disclosure>
        </div>
      </PanelSection>

      <PanelBody>
        {known.source === 'none' ? (
          <Callout tone="info" icon="lock">
            Nothing has been indexed from this browser. If you indexed something earlier
            it is still there, so a conversation id you know will work.
          </Callout>
        ) : null}
        <div className={styles.actions}>
          <Button
            variant="primary"
            icon="filter"
            busy={
              retrieval.search.status === 'running' &&
              retrieval.rewrite.status !== 'running'
            }
            disabled={busy || !ready || settings.budgets.length === 0}
            onClick={() => void retrieval.runRaw()}
          >
            Search
          </Button>
          <Button
            icon="split"
            busy={retrieval.rewrite.status === 'running'}
            disabled={busy || !ready || settings.budgets.length === 0}
            onClick={() => void retrieval.runRewritten()}
          >
            Search with rewrites
          </Button>
          <Button
            variant="ghost"
            icon="refresh"
            disabled={busy}
            onClick={retrieval.reset}
          >
            Reset
          </Button>
        </div>
      </PanelBody>
    </Panel>
  )
}
