import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  Button,
  Callout,
  ChipList,
  DataTable,
  Disclosure,
  Icon,
  TextField,
} from '@/components/ui'
import { useShell } from '@/app/shell-context'
import {
  benchmarkSetupKey,
  isPreparedBenchmark,
  matchesPreparedBenchmark,
} from '@/features/pipeline/benchmark'
import { IndexPhase } from '@/features/pipeline/phases/IndexPhase'
import { LoadPhase } from '@/features/pipeline/phases/LoadPhase'
import { PreparePhase } from '@/features/pipeline/phases/PreparePhase'
import { SplitPhase } from '@/features/pipeline/phases/SplitPhase'
import { SETUP_STEPS } from '@/features/pipeline/steps'
import { PHASE_ORDER, sizesFor } from '@/features/pipeline/usePipeline'
import { PARTITIONS } from '@/lib/api'
import { count, duration } from '@/lib/format'
import { useElapsed } from '@/lib/useElapsed'
import styles from './SetupPage.module.css'

/** The three partitions as percentage fields, in the order they are spoken. */
const SHARE_FIELDS = [
  { key: 'train', label: 'Train', note: '%' },
  { key: 'validation', label: 'Validation', note: '%' },
  { key: 'test', label: 'Test', note: '% held out' },
] as const

const PARTITION_LABELS = {
  train: 'Train',
  validation: 'Validation',
  test: 'Test (held out)',
}

function StepRow({
  label,
  doing,
  status,
  startedAt,
  elapsedMs,
}: {
  label: string
  doing: string
  status: 'idle' | 'running' | 'done' | 'failed'
  startedAt: number | null
  elapsedMs?: number
}) {
  const live = useElapsed(status === 'running' ? startedAt : null)

  return (
    <li className={`${styles.step} ${styles[status]}`}>
      <span className={styles.bullet} aria-hidden="true">
        {status === 'done' ? (
          <Icon name="check" size={13} strokeWidth={2.5} />
        ) : status === 'running' ? (
          <Icon name="spinner" size={13} className={styles.spin} />
        ) : status === 'failed' ? (
          <Icon name="alert" size={13} />
        ) : null}
      </span>
      <span className={styles.stepLabel}>{status === 'running' ? doing : label}</span>
      <span className={styles.stepTime}>
        {status === 'running' ? duration(live) : null}
        {status === 'done' && elapsedMs !== undefined ? duration(elapsedMs) : null}
      </span>
    </li>
  )
}

/**
 * Getting data in, as one thing you do rather than four.
 *
 * The four backend stages still run in order and still hand ids to each other,
 * but that is the machine's business. One button does the lot with defaults
 * that work; the per-stage forms are still here for anyone who needs them,
 * folded away.
 */
export function SetupPage() {
  const { pipeline, workspace, health, evaluation, rewardBuild } = useShell()
  const navigate = useNavigate()
  const [custom, setCustom] = useState(false)

  useEffect(() => {
    document.title = 'Set up the data · Memory Query Rewriter'
  }, [])

  const { state, settings } = pipeline
  const failed = PHASE_ORDER.find((key) => state[key].status === 'failed')
  const indexed = state.index.status === 'done' ? state.index.result : null
  const loaded = state.load.status === 'done' ? state.load.result : null
  const finishedNow = indexed !== null
  const alreadyHadData = workspace.status === 'ready'
  const benchmark = evaluation.benchmark
  const savedBenchmark = benchmark
    ? workspace.handles.findLast((handle) =>
        matchesPreparedBenchmark(handle, benchmark),
      )
    : null
  const benchmarkReady =
    benchmark &&
    ((indexed?.partition === 'train' &&
      pipeline.benchmarkSetup?.key === benchmarkSetupKey(benchmark) &&
      pipeline.benchmarkSetup.preparedId === indexed.prepared_id) ||
      workspace.handles.some((handle) => isPreparedBenchmark(handle, benchmark)))
  const prepared = state.prepare.status === 'done' ? state.prepare.result : null
  const split = state.split.status === 'done' ? state.split.result : null
  const saved = indexed
    ? workspace.handles.find((handle) => handle.prepared_id === indexed.prepared_id)
    : alreadyHadData && !pipeline.busy
      ? workspace.latest
      : null
  const justPrepared =
    indexed && prepared?.prepared_id === indexed.prepared_id ? prepared : null
  const partitions = saved?.partitions ?? justPrepared?.partitions
  const localSplit = split && split.split_id === justPrepared?.split_id ? split : null

  // The split is the one choice worth making before anything runs, so it is on
  // the page rather than behind the per-step forms. Percentages, not counts:
  // the counts have to sum to a conversation total nobody knows until the file
  // has been read.
  const shares = settings.splitShares
  const allocated = shares.train + shares.validation + shares.test
  const unbalanced = allocated !== 100
  const shareErrorId = 'setup-share-error'

  /** Changing a percentage also fixes the counts when a dataset is already
   *  loaded, so the per-step form never contradicts this. */
  function setShare(part: (typeof SHARE_FIELDS)[number]['key'], percent: number) {
    const next = {
      ...shares,
      [part]: Number.isFinite(percent) ? percent : 0,
    }
    const sums = next.train + next.validation + next.test === 100
    pipeline.patch({
      splitShares: next,
      ...(loaded && sums ? sizesFor(loaded.conversation_count, next) : {}),
    })
  }

  // Pick the workspace back up once a run lands, so Search sees the new data.
  useEffect(() => {
    if (finishedNow) void workspace.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedNow])

  return (
    <div className={styles.page}>
      <div>
        <h1>Set up the data</h1>
        <p className={styles.lede}>
          This reads the LoCoMo conversations, splits them, and turns every message into
          something searchable. You only need to do it once.
        </p>
      </div>

      {health.state === 'offline' ? (
        <Callout tone="error" title="Can't reach the backend">
          <Button size="sm" icon="refresh" onClick={() => void health.refresh()}>
            Try again
          </Button>
        </Callout>
      ) : null}

      {rewardBuild.busy ? (
        <Callout tone="info" title="A dataset build is running">
          <p>
            Indexing is paused while this build uses the memory store. Wait for it to
            finish or stop it before preparing benchmark data.
          </p>
          <Link to="/training">View build progress</Link>
          {rewardBuild.canStop ? (
            <Button size="sm" onClick={() => void rewardBuild.stop()}>
              Stop build
            </Button>
          ) : null}
        </Callout>
      ) : null}

      {benchmark ? (
        <Callout tone="info" title="Benchmark data">
          <p>
            {benchmarkReady
              ? 'The frozen training split is indexed and ready to build rewrites.'
              : `Prepare the frozen split for ${benchmark.version}: ${benchmark.split.train_conversation_ids.length} train, ${benchmark.split.validation_conversation_ids.length} validation, and ${benchmark.split.test_conversation_ids.length} test conversations.`}
          </p>
          <Button
            size="sm"
            icon="layers"
            disabled={
              pipeline.busy ||
              pipeline.runningAll ||
              Boolean(evaluation.active) ||
              rewardBuild.busy ||
              health.state === 'offline'
            }
            onClick={() =>
              benchmarkReady
                ? void navigate('/training?mode=benchmark')
                : savedBenchmark?.dataset_id
                  ? void pipeline.runIndex(
                      savedBenchmark.dataset_id,
                      savedBenchmark.prepared_id,
                      'train',
                      settings.batchSize,
                    )
                  : void pipeline.runAll(benchmark)
            }
          >
            {benchmarkReady
              ? 'Use saved benchmark data'
              : savedBenchmark
                ? 'Index saved benchmark data'
                : 'Set up benchmark data'}
          </Button>
        </Callout>
      ) : null}

      <section className={styles.runner}>
        <ol className={styles.steps}>
          {SETUP_STEPS.map((step) => {
            const run = state[step.key]
            return (
              <StepRow
                key={step.key}
                label={step.label}
                doing={step.doing}
                status={run.status}
                startedAt={run.status === 'running' ? run.startedAt : null}
                elapsedMs={run.status === 'done' ? run.elapsedMs : undefined}
              />
            )
          })}
        </ol>

        {finishedNow ? null : (
          <fieldset className={styles.choices}>
            <legend className={styles.choicesLegend}>
              How to split the conversations
            </legend>
            <div className={styles.shares}>
              {SHARE_FIELDS.map(({ key, label, note }) => (
                <TextField
                  key={key}
                  label={label}
                  labelNote={note}
                  type="number"
                  min={0}
                  max={100}
                  value={shares[key]}
                  disabled={pipeline.busy}
                  invalid={unbalanced}
                  errorId={shareErrorId}
                  onChange={(event) => setShare(key, Number(event.target.value))}
                />
              ))}
              <TextField
                label="Seed"
                labelNote="shuffle"
                type="number"
                min={0}
                value={settings.seed}
                disabled={pipeline.busy}
                onChange={(event) =>
                  pipeline.update('seed', Number(event.target.value))
                }
                hint="Same seed, same split."
              />
            </div>
            {unbalanced ? (
              <p className={styles.shareError} id={shareErrorId} role="alert">
                <Icon name="alert" size={13} />
                The three come to {allocated}%. They have to add up to 100%.
              </p>
            ) : (
              <p className={styles.note}>
                {shares.train}% to train on, {shares.validation}% to check against,{' '}
                {shares.test}% held back for the final test and never trained on. Exact
                conversation counts are under “Show the details”.
              </p>
            )}
          </fieldset>
        )}

        {finishedNow ? (
          <div className={styles.done}>
            <p className={styles.doneText}>
              Done. <strong>{count(indexed.indexed_memory_count)}</strong> memories from{' '}
              <strong>{count(indexed.conversation_count)}</strong> conversations are
              ready to search.
            </p>
            <Button
              variant="primary"
              icon="arrow"
              onClick={() =>
                void navigate(benchmarkReady ? '/training?mode=benchmark' : '/training')
              }
            >
              Continue to Training data
            </Button>
            <Button variant="ghost" onClick={() => setCustom((value) => !value)}>
              {custom ? 'Hide the details' : 'Show the details'}
            </Button>
          </div>
        ) : (
          <div className={styles.actions}>
            <Button
              variant="primary"
              icon="arrow"
              busy={pipeline.runningAll}
              disabled={
                pipeline.busy ||
                rewardBuild.busy ||
                Boolean(evaluation.active) ||
                unbalanced ||
                health.state === 'offline'
              }
              onClick={() => void pipeline.runAll()}
            >
              {alreadyHadData ? 'Set it up again' : 'Set it up'}
            </Button>
            <Button
              variant="ghost"
              disabled={pipeline.busy}
              onClick={() => setCustom((value) => !value)}
            >
              {custom ? 'Hide the details' : 'Show the details'}
            </Button>
          </div>
        )}

        {failed ? (
          <Callout tone="error" title="That didn't finish" role="alert">
            <p>
              {state[failed].status === 'failed' ? state[failed].error : null}{' '}
              {rewardBuild.busy
                ? 'Wait for the dataset build to finish or stop it above, then retry indexing.'
                : 'Open the settings below to retry just that step.'}
            </p>
          </Callout>
        ) : null}

        {alreadyHadData && !finishedNow && !pipeline.busy ? (
          <p className={styles.note}>
            There are already {count(workspace.indexedMemories)} memories indexed, so
            you can <Link to="/training">continue to Training data</Link>.
          </p>
        ) : null}

        {partitions ? (
          <>
            <DataTable
              caption="Prepared dataset split"
              columns={['Conversations', 'Questions']}
              rows={PARTITIONS.map((partition) => ({
                key: partition,
                header: PARTITION_LABELS[partition],
                highlight: partition === 'test',
                cells: [
                  count(partitions[partition].conversation_count),
                  count(partitions[partition].qa_count),
                ],
              }))}
            />
            {saved || localSplit ? (
              <Disclosure summary="Conversation IDs by split">
                {PARTITIONS.map((partition) => (
                  <div key={partition}>
                    <h3>{PARTITION_LABELS[partition]}</h3>
                    <ChipList
                      items={
                        saved?.partitions[partition].conversation_ids ??
                        localSplit?.[`${partition}_conversation_ids`] ??
                        []
                      }
                      label={`${PARTITION_LABELS[partition]} conversation IDs`}
                    />
                  </div>
                ))}
              </Disclosure>
            ) : null}
          </>
        ) : null}
      </section>

      {custom || failed ? (
        <Disclosure summary="Each step on its own" defaultOpen>
          <div className={styles.phases}>
            <LoadPhase pipeline={pipeline} />
            <SplitPhase pipeline={pipeline} />
            <PreparePhase pipeline={pipeline} />
            <IndexPhase
              pipeline={pipeline}
              blocked={rewardBuild.busy || Boolean(evaluation.active)}
            />
          </div>
        </Disclosure>
      ) : null}
    </div>
  )
}
