import {
  AllocationBar,
  Button,
  Callout,
  ChipList,
  CopyValue,
  Disclosure,
  Icon,
  Stat,
  StatGrid,
  TextField,
  type AllocationSegment,
} from '@/components/ui'
import { PhaseCard, PhaseControls, Readout } from '../PhaseCard'
import { proposeSplit, statusOf, type usePipeline } from '../usePipeline'
import styles from './SplitPhase.module.css'

const PRESETS = [
  { label: '70 / 10 / 20', train: 0.7, test: 0.2 },
  { label: '80 / 10 / 10', train: 0.8, test: 0.1 },
] as const

function apply(total: number, train: number, test: number) {
  const trainSize = Math.min(total, Math.round(total * train))
  const testSize = Math.min(total - trainSize, Math.round(total * test))
  return { trainSize, validationSize: total - trainSize - testSize, testSize }
}

export function SplitPhase({ pipeline }: { pipeline: ReturnType<typeof usePipeline> }) {
  const { state, settings, update, patch, busy } = pipeline
  const run = state.split
  const result = run.status === 'done' ? run.result : null
  const loaded = state.load.status === 'done' ? state.load.result : null

  const total = loaded?.conversation_count ?? 0
  const allocated = settings.trainSize + settings.validationSize + settings.testSize
  const balanced = total > 0 && allocated === total
  const sumErrorId = 'split-sum-error'

  // The backend raises 422 unless the three sizes sum to the conversation
  // count, so the constraint is stated here instead of arriving as a failure.
  const sumError = !loaded
    ? null
    : allocated === total
      ? null
      : allocated > total
        ? `Over by ${allocated - total}. The three sizes have to sum to exactly ${total}, because the split must account for every conversation in the dataset.`
        : `${total - allocated} conversation${total - allocated === 1 ? '' : 's'} unassigned. The three sizes have to sum to exactly ${total}.`

  const preview: AllocationSegment[] = [
    { key: 'train', label: 'Train', value: settings.trainSize, tone: 'primary' },
    {
      key: 'validation',
      label: 'Validation',
      value: settings.validationSize,
      tone: 'secondary',
    },
    { key: 'test', label: 'Test', value: settings.testSize, tone: 'tertiary' },
  ]

  const actual: AllocationSegment[] = result
    ? [
        {
          key: 'train',
          label: 'Train',
          value: result.train_conversation_ids.length,
          tone: 'primary',
        },
        {
          key: 'validation',
          label: 'Validation',
          value: result.validation_conversation_ids.length,
          tone: 'secondary',
        },
        {
          key: 'test',
          label: 'Test',
          value: result.test_conversation_ids.length,
          tone: 'tertiary',
        },
      ]
    : []

  return (
    <PhaseCard
      id="phase-split"
      step={2}
      title="Split by conversation"
      purpose="Shuffle the conversation ids with a fixed seed and cut them into train, validation and test. A conversation belongs to exactly one partition."
      endpoint="POST /data/{dataset_id}/splits"
      status={statusOf(run, loaded === null)}
      blockedReason={
        loaded
          ? undefined
          : 'Load a dataset first. A split has to account for exactly the conversations the dataset contains, so the sizes cannot be chosen before the count is known.'
      }
      startedAt={run.status === 'running' ? run.startedAt : null}
      elapsedMs={
        run.status === 'done' || run.status === 'failed' ? run.elapsedMs : undefined
      }
      error={run.status === 'failed' ? run.error : undefined}
      runningNote="Sorting the ids, shuffling them with the seed, and slicing the three partitions."
      controls={
        <PhaseControls
          inputs={
            <>
              <TextField
                label="Train"
                labelNote="conversations"
                type="number"
                min={0}
                max={total || undefined}
                value={settings.trainSize}
                disabled={busy || !loaded}
                invalid={Boolean(sumError)}
                errorId={sumErrorId}
                onChange={(event) => update('trainSize', Number(event.target.value))}
              />
              <TextField
                label="Validation"
                labelNote="conversations"
                type="number"
                min={0}
                max={total || undefined}
                value={settings.validationSize}
                disabled={busy || !loaded}
                invalid={Boolean(sumError)}
                errorId={sumErrorId}
                onChange={(event) =>
                  update('validationSize', Number(event.target.value))
                }
              />
              <TextField
                label="Test"
                labelNote="held out"
                type="number"
                min={0}
                max={total || undefined}
                value={settings.testSize}
                disabled={busy || !loaded}
                invalid={Boolean(sumError)}
                errorId={sumErrorId}
                onChange={(event) => update('testSize', Number(event.target.value))}
              />
              <TextField
                label="Seed"
                labelNote="shuffle"
                type="number"
                value={settings.seed}
                disabled={busy || !loaded}
                onChange={(event) => update('seed', Number(event.target.value))}
                hint="Same seed, same partition. Repeat runs vary this on purpose."
              />
            </>
          }
          preview={
            loaded ? (
              <div className={styles.preview}>
                <div className={styles.previewHead}>
                  <span className={styles.previewLabel}>Allocation</span>
                  <span
                    className={`${styles.tally} ${sumError ? styles.tallyOff : ''}`}
                  >
                    <Icon name={sumError ? 'alert' : 'check'} size={12} />
                    {allocated} / {total}
                  </span>
                </div>
                <AllocationBar segments={preview} total={total} unit="conv" />
                {sumError ? (
                  <p className={styles.sumError} id={sumErrorId} role="alert">
                    {sumError}
                  </p>
                ) : null}
              </div>
            ) : null
          }
          action={
            <>
              <Button
                variant="primary"
                icon="split"
                busy={run.status === 'running'}
                disabled={busy || !loaded || !balanced}
                onClick={() => {
                  if (!loaded) return
                  void pipeline.runSplit(loaded.dataset_id, {
                    trainSize: settings.trainSize,
                    validationSize: settings.validationSize,
                    testSize: settings.testSize,
                    seed: settings.seed,
                  })
                }}
              >
                {result ? 'Re-split' : 'Create split'}
              </Button>
              {PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  size="sm"
                  variant="ghost"
                  disabled={busy || !loaded}
                  onClick={() => patch(apply(total, preset.train, preset.test))}
                >
                  {preset.label}
                </Button>
              ))}
              {loaded && sumError ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => patch(proposeSplit(total))}
                >
                  Balance to {total}
                </Button>
              ) : null}
            </>
          }
        />
      }
      insight={
        result ? (
          <>
            <AllocationBar segments={actual} total={total} unit="conv" />

            <StatGrid>
              <Stat
                label="Seed"
                value={result.seed}
                hint="Reproduces this exact partition."
                onSunken
                accent
              />
              <Stat
                label="Held out for test"
                value={result.test_conversation_ids.length}
                unit={`of ${total}`}
                hint="Every ladder number is measured here."
                onSunken
              />
              <Stat
                label="Split id"
                value={<CopyValue value={result.split_id} label="split id" />}
                text
                hint="Passed to prepare in phase 3."
                onSunken
              />
            </StatGrid>

            <Readout>
              Seed <strong>{result.seed}</strong> sorted the ids, shuffled them, and cut
              them into <strong>{result.train_conversation_ids.length}</strong> /{' '}
              <strong>{result.validation_conversation_ids.length}</strong> /{' '}
              <strong>{result.test_conversation_ids.length}</strong>. Sorting before
              shuffling is what makes this deterministic — the same seed always produces
              the same partition, so a repeat run is comparable and a different seed is
              a genuinely different sample.
            </Readout>

            <Callout tone="info">
              The test ids are held out: nothing in training, candidate generation or
              reward scoring may read them. All six ladder configurations are measured
              on this partition and only this one.
            </Callout>

            <div className={styles.partitions}>
              <Disclosure
                summary="Train conversation ids"
                count={result.train_conversation_ids.length}
              >
                <ChipList items={result.train_conversation_ids} label="Train ids" />
              </Disclosure>
              <Disclosure
                summary="Validation conversation ids"
                count={result.validation_conversation_ids.length}
              >
                <ChipList
                  items={result.validation_conversation_ids}
                  label="Validation ids"
                />
              </Disclosure>
              <Disclosure
                summary="Test conversation ids (held out)"
                count={result.test_conversation_ids.length}
              >
                <ChipList items={result.test_conversation_ids} label="Test ids" />
              </Disclosure>
            </div>
          </>
        ) : null
      }
    />
  )
}
