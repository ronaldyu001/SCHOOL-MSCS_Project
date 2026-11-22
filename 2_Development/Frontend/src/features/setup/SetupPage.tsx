import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button, Callout, ChipList, DataTable, Disclosure, Icon } from '@/components/ui'
import { useShell } from '@/app/shell-context'
import { IndexPhase } from '@/features/pipeline/phases/IndexPhase'
import { LoadPhase } from '@/features/pipeline/phases/LoadPhase'
import { PreparePhase } from '@/features/pipeline/phases/PreparePhase'
import { SplitPhase } from '@/features/pipeline/phases/SplitPhase'
import { SETUP_STEPS } from '@/features/pipeline/steps'
import { PHASE_ORDER } from '@/features/pipeline/usePipeline'
import { PARTITIONS } from '@/lib/api'
import { count, duration } from '@/lib/format'
import { useElapsed } from '@/lib/useElapsed'
import styles from './SetupPage.module.css'

const PARTITION_LABELS = { train: 'Train', validation: 'Validation', test: 'Test (held out)' }

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
  const { pipeline, workspace, health } = useShell()
  const navigate = useNavigate()
  const [custom, setCustom] = useState(false)

  useEffect(() => {
    document.title = 'Set up the data · Memory Query Rewriter'
  }, [])

  const { state } = pipeline
  const failed = PHASE_ORDER.find((key) => state[key].status === 'failed')
  const indexed = state.index.status === 'done' ? state.index.result : null
  const loaded = state.load.status === 'done' ? state.load.result : null
  const finishedNow = indexed !== null
  const alreadyHadData = workspace.status === 'ready'
  const prepared = state.prepare.status === 'done' ? state.prepare.result : null
  const split = state.split.status === 'done' ? state.split.result : null
  const saved = indexed
    ? workspace.handles.find((handle) => handle.prepared_id === indexed.prepared_id)
    : alreadyHadData && !pipeline.busy
      ? workspace.latest
      : null
  const justPrepared = indexed && prepared?.prepared_id === indexed.prepared_id ? prepared : null
  const partitions = saved?.partitions ?? justPrepared?.partitions
  const localSplit = split && split.split_id === justPrepared?.split_id ? split : null

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

        {finishedNow ? (
          <div className={styles.done}>
            <p className={styles.doneText}>
              Done. <strong>{count(indexed.indexed_memory_count)}</strong> memories from{' '}
              <strong>{count(loaded?.conversation_count ?? 0)}</strong> conversations
              are ready to search.
            </p>
            <Button variant="primary" icon="arrow" onClick={() => void navigate('/training')}>
              Continue to Training data
            </Button>
          </div>
        ) : (
          <div className={styles.actions}>
            <Button
              variant="primary"
              icon="arrow"
              busy={pipeline.runningAll}
              disabled={pipeline.busy || health.state === 'offline'}
              onClick={() => void pipeline.runAll()}
            >
              {alreadyHadData ? 'Set it up again' : 'Set it up'}
            </Button>
            <Button
              variant="ghost"
              disabled={pipeline.busy}
              onClick={() => setCustom((value) => !value)}
            >
              {custom ? 'Hide the details' : 'Change the settings'}
            </Button>
          </div>
        )}

        {failed ? (
          <Callout tone="error" title="That didn't finish" role="alert">
            <p>
              {state[failed].status === 'failed' ? state[failed].error : null} Open the
              settings below to retry just that step.
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
                      items={saved?.partitions[partition].conversation_ids ??
                        localSplit?.[`${partition}_conversation_ids`] ?? []}
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
            <IndexPhase pipeline={pipeline} />
          </div>
        </Disclosure>
      ) : null}
    </div>
  )
}
