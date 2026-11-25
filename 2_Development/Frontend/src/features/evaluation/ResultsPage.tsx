import { useEffect } from 'react'
import { useShell } from '@/app/shell-context'
import {
  Button,
  ButtonLink,
  Callout,
  Disclosure,
  MetricBar,
  OptionChips,
  Panel,
  PanelBody,
  PanelHeader,
  PanelSection,
  SelectField,
  Stat,
  StatGrid,
  StatusBadge,
  TextField,
  type PhaseStatus,
} from '@/components/ui'
import {
  evaluationDownloadUrl,
  REWARD_IDS,
  type EvaluationAdapterSelection,
  type EvaluationBenchmark,
  type EvaluationMode,
  type EvaluationRun,
  type RewardId,
} from '@/lib/api'
import { count, shortId } from '@/lib/format'
import { BenchmarkReport } from './BenchmarkReport'
import { eligibleAdapter, hardwareFingerprint } from './evaluationAdapters'
import styles from './ResultsPage.module.css'

const MODE_LABEL: Record<EvaluationMode, string> = {
  pilot: 'Validation pilot',
  official: 'Official test',
}

const STATUS: Record<EvaluationRun['status'], { status: PhaseStatus; label: string }> =
  {
    queued: { status: 'idle', label: 'Queued' },
    running: { status: 'running', label: 'Evaluating' },
    completed: { status: 'done', label: 'Complete' },
    failed: { status: 'failed', label: 'Failed' },
    interrupted: { status: 'failed', label: 'Interrupted' },
  }

const PHASE: Record<string, string> = {
  preparing: 'Preparing the held-out questions',
  indexing: 'Indexing the held-out conversations',
  scoring: 'Scoring rewrites',
}

const VARIANT_LABEL: Record<string, string> = {
  raw: 'Raw query',
  prompted: 'Prompted baseline',
  gold_query: 'Gold-evidence query',
}

function SavedEvaluation({ run }: { run: EvaluationRun }) {
  const { phase, variant, completed, total } = run.progress
  const active = run.status === 'queued' || run.status === 'running'
  const stepped = completed !== undefined && total !== undefined && total > 0
  const detail = variant ? (VARIANT_LABEL[variant] ?? variant.toUpperCase()) : null

  return (
    <>
      <Panel>
        <PanelHeader
          title={MODE_LABEL[run.mode]}
          description={`${run.benchmark.version} · ${shortId(run.id)}`}
          aside={<StatusBadge {...STATUS[run.status]} />}
        />
        <PanelBody className={styles.stack}>
          {active ? (
            <p role="status">
              {phase
                ? (PHASE[phase] ?? phase.replaceAll('_', ' '))
                : 'Waiting to start'}
              {detail ? ` · ${detail}` : null}
            </p>
          ) : null}
          {active && stepped ? (
            <MetricBar
              caption="Question and configuration pairs scored"
              max={total}
              rows={[
                {
                  key: 'progress',
                  label: 'Scored',
                  value: completed,
                  readout: `${count(completed)} / ${count(total)}`,
                },
              ]}
            />
          ) : null}
          {run.error ? (
            <Callout tone="error" title="Evaluation stopped" role="alert">
              <p>{run.error}</p>
            </Callout>
          ) : null}
          {run.status === 'completed' ? (
            <ButtonLink
              href={evaluationDownloadUrl(run.id)}
              variant="secondary"
              icon="copy"
              className={styles.download}
            >
              Download report ZIP
            </ButtonLink>
          ) : null}
        </PanelBody>
      </Panel>
      {run.status === 'completed' && run.summary ? (
        <BenchmarkReport key={run.id} summary={run.summary} />
      ) : null}
    </>
  )
}

type AdapterOption = {
  seed: number
  reward: RewardId
  label: string
}

function StartEvaluation({ benchmark }: { benchmark: EvaluationBenchmark }) {
  const { evaluation, artifacts, rewardBuild, health } = useShell()
  const {
    mode,
    setMode,
    pilotSeed,
    setPilotSeed,
    pilotLimit,
    setPilotLimit,
    selections,
    setAdapter,
  } = evaluation
  const seed =
    pilotSeed !== null && benchmark.seeds.includes(pilotSeed)
      ? pilotSeed
      : benchmark.seeds[0]
  const seeds = mode === 'pilot' ? (seed === undefined ? [] : [seed]) : benchmark.seeds
  const busy =
    evaluation.submitting ||
    Boolean(evaluation.active || artifacts.active || rewardBuild.busy)
  const options = seeds.flatMap((seedValue) =>
    REWARD_IDS.map((reward) => {
      const matching = artifacts.runs.filter(
        (run) =>
          run.reward === reward &&
          eligibleAdapter(run, seedValue, benchmark, mode, artifacts.datasets),
      )
      const selected =
        matching.find((run) => run.id === selections[seedValue]?.[reward]) ??
        matching[0]
      return { seed: seedValue, reward, matching, selected }
    }),
  )
  const missing: AdapterOption[] = options
    .filter(({ selected }) => !selected)
    .map(({ seed: seedValue, reward }) => ({
      seed: seedValue,
      reward,
      label: reward.toUpperCase(),
    }))
  const hardware = new Set(
    options.flatMap(({ selected }) =>
      selected ? [hardwareFingerprint(selected)] : [],
    ),
  )
  const inconsistentHardware =
    mode === 'official' && missing.length === 0 && hardware.size > 1
  const limit = pilotLimit.trim() === '' ? undefined : Number(pilotLimit)
  const invalidLimit =
    mode === 'pilot' &&
    limit !== undefined &&
    (!Number.isSafeInteger(limit) || limit < 1)

  function start() {
    const adapters: EvaluationAdapterSelection = {}
    for (const { seed: seedValue, reward, selected } of options) {
      if (!selected) return
      adapters[seedValue] ??= { r0: '', r1: '', r2: '', r3: '' }
      adapters[seedValue][reward] = selected.id
    }
    void evaluation.start({
      mode,
      adapters,
      pilotLimit: mode === 'pilot' ? limit : undefined,
    })
  }

  const partitions = benchmark.split
  const disabled =
    busy ||
    health.state === 'offline' ||
    missing.length > 0 ||
    inconsistentHardware ||
    invalidLimit ||
    seeds.length === 0

  return (
    <Panel>
      <PanelHeader title="Run an evaluation" description={benchmark.version} />
      <PanelSection sunken>
        <StatGrid>
          <Stat
            label="Conversations"
            value={`${partitions.train_conversation_ids.length} / ${partitions.validation_conversation_ids.length} / ${partitions.test_conversation_ids.length}`}
            hint="Training / validation / test"
            onSunken
          />
          <Stat
            label="Base checkpoint"
            value={benchmark.model_id}
            hint={shortId(benchmark.model_revision)}
            text
            onSunken
          />
          <Stat
            label="Retrieval depth"
            value={count(benchmark.top_k)}
            unit="memories"
            onSunken
          />
        </StatGrid>
      </PanelSection>
      <PanelSection className={styles.stack}>
        <OptionChips
          legend="Evaluation mode"
          selected={mode}
          disabled={busy}
          options={[
            { value: 'pilot', label: MODE_LABEL.pilot },
            { value: 'official', label: MODE_LABEL.official },
          ]}
          onPick={(value) => setMode(value === 'official' ? 'official' : 'pilot')}
        />
        <p className={styles.hint}>
          {mode === 'pilot'
            ? 'Uses four adapters from a single seed on the validation split.'
            : `Uses the full test split and four matched CUDA adapters at each frozen seed (${benchmark.seeds.join(', ')}).`}
        </p>
        {mode === 'pilot' ? (
          <div className={styles.fields}>
            <SelectField
              label="Seed"
              value={seed ?? ''}
              disabled={busy}
              onChange={(event) => setPilotSeed(Number(event.target.value))}
            >
              {benchmark.seeds.map((seedValue) => (
                <option key={seedValue} value={seedValue}>
                  {seedValue}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Question limit"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              placeholder="All validation questions"
              value={pilotLimit}
              disabled={busy}
              error={invalidLimit ? 'Enter a positive whole number.' : undefined}
              onChange={(event) => setPilotLimit(event.target.value)}
            />
          </div>
        ) : null}
        {seeds.map((seedValue) => (
          <fieldset className={styles.adapterGroup} key={seedValue}>
            <legend>Seed {seedValue} adapters</legend>
            <div className={styles.fields}>
              {options
                .filter((item) => item.seed === seedValue)
                .map(({ reward, matching, selected }) => (
                  <SelectField
                    key={reward}
                    label={`${reward.toUpperCase()} adapter`}
                    value={selected?.id ?? ''}
                    disabled={busy || !matching.length}
                    onChange={(event) =>
                      setAdapter(seedValue, reward, event.target.value)
                    }
                  >
                    {!matching.length ? (
                      <option value="">No matching run</option>
                    ) : null}
                    {matching.map((run) => (
                      <option value={run.id} key={run.id}>
                        {run.name} · {shortId(run.id)}
                        {mode === 'official' && run.runtime?.gpu_name
                          ? ` · ${run.runtime.gpu_name}`
                          : ''}
                      </option>
                    ))}
                  </SelectField>
                ))}
            </div>
          </fieldset>
        ))}
        <Disclosure summary="Frozen benchmark settings">
          <dl className={styles.profileFacts}>
            <dt>Checkpoint revision</dt>
            <dd>
              <code>{benchmark.model_revision}</code>
            </dd>
            <dt>Encoder</dt>
            <dd>{benchmark.embedding.embedding_model}</dd>
            <dt>Token budgets</dt>
            <dd>{benchmark.token_budgets.map(count).join(', ')}</dd>
            <dt>Training conversations</dt>
            <dd>{partitions.train_conversation_ids.join(', ')}</dd>
            <dt>Validation conversations</dt>
            <dd>{partitions.validation_conversation_ids.join(', ')}</dd>
            <dt>Test conversations</dt>
            <dd>{partitions.test_conversation_ids.join(', ')}</dd>
            <dt>Official training hardware</dt>
            <dd>
              {benchmark.hardware.training_device.toUpperCase()} ·{' '}
              {benchmark.hardware.base_weight_dtype} weights ·{' '}
              {benchmark.hardware.mixed_precision} mixed precision ·{' '}
              {benchmark.hardware.target_vram_gib} GiB target
            </dd>
          </dl>
        </Disclosure>
      </PanelSection>
      <PanelBody className={styles.stack}>
        {artifacts.checked && missing.length > 0 ? (
          <Callout tone="info" title="More adapters needed">
            <p>
              {missing
                .map(({ seed: seedValue, label }) => `${label} (seed ${seedValue})`)
                .join(', ')}
            </p>
            <p>
              Use the benchmark settings in Training data and Fine-tuning to fill these
              slots.
            </p>
            <div className={styles.actions}>
              <ButtonLink to="/training" size="sm" variant="ghost">
                Training data
              </ButtonLink>
              <ButtonLink to="/fine-tuning" size="sm" variant="ghost">
                Fine-tuning
              </ButtonLink>
            </div>
          </Callout>
        ) : null}
        {inconsistentHardware ? (
          <Callout tone="warn">
            Select adapters trained with the same GPU and runtime for the official test.
          </Callout>
        ) : null}
        {busy && !evaluation.submitting ? (
          <Callout tone="info">
            Wait for the active run to finish before starting an evaluation.
          </Callout>
        ) : null}
        {evaluation.submitError ? (
          <Callout tone="error" title="Couldn't start evaluation" role="alert">
            <p>{evaluation.submitError}</p>
          </Callout>
        ) : null}
        <div className={styles.actions}>
          <Button
            variant="primary"
            icon="arrow"
            busy={evaluation.submitting}
            disabled={disabled}
            onClick={start}
          >
            {mode === 'pilot' ? 'Run validation pilot' : 'Run official test'}
          </Button>
        </div>
      </PanelBody>
    </Panel>
  )
}

export function ResultsPage() {
  const { evaluation, artifacts } = useShell()
  const { benchmark, runs, selectedRunId, setSelectedRunId } = evaluation
  const run =
    runs.find((item) => item.id === selectedRunId) ?? evaluation.active ?? runs[0]

  useEffect(() => {
    document.title = 'Results · Memory Query Rewriter'
  }, [])

  return (
    <div className={styles.page}>
      <header>
        <h1>Results</h1>
        <p className={styles.lede}>
          See how much evidence the raw query, prompted baseline, and four trained
          rewriters find at each token budget.
        </p>
      </header>

      {evaluation.error || artifacts.error ? (
        <Callout
          tone={evaluation.error ? 'error' : 'warn'}
          title="Couldn't refresh results"
          role="alert"
        >
          {evaluation.error ? <p>{evaluation.error}</p> : null}
          {artifacts.error ? <p>{artifacts.error}</p> : null}
          <Button
            size="sm"
            icon="refresh"
            onClick={() =>
              void Promise.all([evaluation.refresh(), artifacts.refresh()])
            }
          >
            Try again
          </Button>
        </Callout>
      ) : null}

      {!evaluation.checked ? (
        <p role="status" className={styles.hint}>
          Loading benchmark and runs…
        </p>
      ) : null}

      {runs.length > 0 && run ? (
        <>
          <div className={styles.history}>
            <SelectField
              label="Saved evaluations"
              value={run.id}
              onChange={(event) => setSelectedRunId(event.target.value)}
            >
              {runs.map((item) => (
                <option key={item.id} value={item.id}>
                  {MODE_LABEL[item.mode]} · {new Date(item.created_at).toLocaleString()}{' '}
                  · {STATUS[item.status].label}
                </option>
              ))}
            </SelectField>
            {evaluation.active && evaluation.active.id !== run.id ? (
              <Button
                size="sm"
                onClick={() => setSelectedRunId(evaluation.active?.id ?? null)}
              >
                Show active evaluation
              </Button>
            ) : null}
          </div>
          <SavedEvaluation run={run} />
        </>
      ) : null}

      {benchmark ? <StartEvaluation benchmark={benchmark} /> : null}
    </div>
  )
}
