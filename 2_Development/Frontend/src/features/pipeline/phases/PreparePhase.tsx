import {
  Button,
  Callout,
  CheckGroup,
  CopyValue,
  DataTable,
  Disclosure,
  Stat,
  StatGrid,
  type CheckOption,
} from '@/components/ui'
import { PARTITIONS, type QACategory } from '@/lib/api'
import { categoryLabel, count, percent } from '@/lib/format'
import { PhaseCard, PhaseControls, Readout } from '../PhaseCard'
import { statusOf, type usePipeline } from '../usePipeline'

/* The proposal reports results for four categories. LoCoMo also carries an
 * `adversarial` set, which is filterable here but marked so it is not mistaken
 * for one of the reported four. */
const CATEGORY_OPTIONS: CheckOption<QACategory>[] = [
  { value: 'single_hop', label: 'Single-hop', tag: 'reported' },
  { value: 'multi_hop', label: 'Multi-hop', tag: 'reported' },
  { value: 'temporal', label: 'Temporal', tag: 'reported' },
  { value: 'open_domain', label: 'Open-domain', tag: 'reported' },
  { value: 'adversarial', label: 'Adversarial', tag: 'extra' },
]

/** What PrepareDataset actually asserts before it returns. */
const CHECKS = [
  'Conversation ids are unique across the dataset',
  'Question ids are unique across the dataset',
  'Every id named in the split exists in the dataset',
  'The split covers every conversation, with none left over',
  'No question references a conversation that is not present',
]

export function PreparePhase({
  pipeline,
}: {
  pipeline: ReturnType<typeof usePipeline>
}) {
  const { state, settings, update, busy } = pipeline
  const run = state.prepare
  const result = run.status === 'done' ? run.result : null
  const loaded = state.load.status === 'done' ? state.load.result : null
  const split = state.split.status === 'done' ? state.split.result : null

  const retained = result
    ? PARTITIONS.reduce((sum, name) => sum + result.partitions[name].qa_count, 0)
    : 0
  const filtered = Boolean(result?.categories && result.categories.length > 0)

  function toggle(category: QACategory) {
    update(
      'categories',
      settings.categories.includes(category)
        ? settings.categories.filter((item) => item !== category)
        : [...settings.categories, category],
    )
  }

  return (
    <PhaseCard
      id="phase-prepare"
      step={3}
      title="Prepare the partitions"
      purpose="Group the conversations and questions by partition, and check everything lines up."
      status={statusOf(run, split === null)}
      blockedReason={split ? undefined : 'Make a split first.'}
      startedAt={run.status === 'running' ? run.startedAt : null}
      elapsedMs={
        run.status === 'done' || run.status === 'failed' ? run.elapsedMs : undefined
      }
      error={run.status === 'failed' ? run.error : undefined}
      runningNote="Checking and grouping."
      controls={
        <PhaseControls
          preview={
            <CheckGroup
              legend="Question categories"
              options={CATEGORY_OPTIONS}
              selected={settings.categories}
              disabled={busy || !split}
              onToggle={toggle}
              hint={
                settings.categories.length === 0
                  ? 'None selected, so no filter is sent and every category is kept. Filtering narrows the questions only — the conversations in each partition are unaffected, so the memory store stays identical either way.'
                  : `Keeping ${settings.categories.length} of ${CATEGORY_OPTIONS.length} categories. The conversations in each partition are unaffected.`
              }
            />
          }
          action={
            <Button
              variant="primary"
              icon="filter"
              busy={run.status === 'running'}
              disabled={busy || !split}
              onClick={() => {
                if (!split) return
                void pipeline.runPrepare(
                  split.dataset_id,
                  split.split_id,
                  settings.categories,
                )
              }}
            >
              {result ? 'Re-prepare' : 'Prepare partitions'}
            </Button>
          }
        />
      }
      insight={
        result ? (
          <>
            <DataTable
              caption="Partition contents"
              columns={['Conversations', 'Questions']}
              rows={PARTITIONS.map((name) => ({
                key: name,
                header: name === 'test' ? 'test (held out)' : name,
                highlight: name === 'test',
                cells: [
                  count(result.partitions[name].conversation_count),
                  count(result.partitions[name].qa_count),
                ],
              }))}
              footer={{
                header: 'Total',
                cells: [
                  count(
                    PARTITIONS.reduce(
                      (sum, name) => sum + result.partitions[name].conversation_count,
                      0,
                    ),
                  ),
                  count(retained),
                ],
              }}
            />

            <StatGrid>
              <Stat
                label="Integrity"
                value="Passed"
                hint={`${CHECKS.length} assertions on the dataset and split.`}
                onSunken
                accent
                text
              />
              <Stat
                label="Questions kept"
                value={count(retained)}
                unit={loaded ? `of ${count(loaded.qa_count)}` : undefined}
                hint={
                  loaded
                    ? `${percent(retained, loaded.qa_count)} of everything loaded.`
                    : undefined
                }
                onSunken
              />
              <Stat
                label="Category filter"
                value={
                  filtered
                    ? (result.categories ?? []).map(categoryLabel).join(', ')
                    : 'All categories'
                }
                text
                hint={filtered ? 'Sent as an explicit list.' : 'Sent as null.'}
                onSunken
              />
              <Stat
                label="Prepared id"
                value={<CopyValue value={result.prepared_id} label="prepared id" />}
                text
                onSunken
              />
            </StatGrid>

            <Readout>
              {loaded && retained < loaded.qa_count ? (
                <>
                  Kept <strong>{count(retained)}</strong> of{' '}
                  <strong>{count(loaded.qa_count)}</strong> questions. The filter only
                  changes which questions get asked, not what goes into the store.
                </>
              ) : (
                <>
                  All <strong>{count(retained)}</strong> questions are in.
                </>
              )}
            </Readout>

            <Disclosure summary="What “integrity passed” checked" count={CHECKS.length}>
              <ul
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-2)',
                  listStyle: 'none',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--fg-muted)',
                }}
              >
                {CHECKS.map((check) => (
                  <li key={check}>· {check}</li>
                ))}
              </ul>
            </Disclosure>

            {result.partitions.test.qa_count === 0 ? (
              <Callout tone="warn" title="The held-out partition has no questions">
                Evaluation reports on the test partition, so it needs both conversations
                and questions. Widen the category filter or move conversations into test
                in phase 2.
              </Callout>
            ) : null}
          </>
        ) : null
      }
    />
  )
}
