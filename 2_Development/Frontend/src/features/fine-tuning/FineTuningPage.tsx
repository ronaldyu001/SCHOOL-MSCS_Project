import { useEffect } from 'react'
import { useSearchParams } from 'react-router'
import {
  Button,
  ButtonLink,
  Callout,
  CheckGroup,
  Disclosure,
  OptionChips,
  Panel,
  PanelBody,
  PanelHeader,
  PanelSection,
  SelectField,
  TextField,
} from '@/components/ui'
import { useShell } from '@/app/shell-context'
import { hasBenchmarkSource, isFrozenRewardBuild } from '@/features/pipeline/benchmark'
import {
  REWARD_IDS,
  TRAINING_DEFAULTS,
  TRAINING_LIMITS,
  type SavedRewardDataset,
  type TrainingSettings,
} from '@/lib/api'
import { count } from '@/lib/format'
import { RunProgress } from './RunProgress'
import { benchmarkTrainingSettings, invalidSettings } from './useFineTune'
import styles from './FineTuningPage.module.css'

/** The advanced numeric settings, in the order they matter to a reader. */
const KNOBS: { key: keyof TrainingSettings; label: string; hint?: string }[] = [
  { key: 'epochs', label: 'Epochs', hint: 'Passes over the dataset.' },
  { key: 'learningRate', label: 'Learning rate' },
  { key: 'batchSize', label: 'Batch size' },
  { key: 'gradientAccumulationSteps', label: 'Gradient accumulation' },
  { key: 'maxLength', label: 'Max tokens', hint: 'Longer examples are skipped.' },
  { key: 'loraRank', label: 'LoRA rank' },
  { key: 'loraAlpha', label: 'LoRA alpha' },
  { key: 'seed', label: 'Seed' },
]

function datasetLabel(dataset: SavedRewardDataset) {
  const { seed, max_inputs_per_reward: limit } = dataset.provenance.settings ?? {}
  const generator = dataset.provenance.rewrite_generator?.model_id
  return [
    dataset.name,
    seed === undefined ? null : `Seed ${seed}`,
    limit === null ? 'Full split' : limit === undefined ? null : `Cap ${count(limit)}`,
    generator,
    `${count(dataset.row_count)} rows`,
    new Date(dataset.created_at).toLocaleString(),
  ]
    .filter(Boolean)
    .join(' · ')
}

export function FineTuningPage() {
  const { artifacts, fineTune, health, evaluation, model, rewardBuild } = useShell()
  const [params, setParams] = useSearchParams()

  useEffect(() => {
    document.title = 'Fine-tuning · Memory Query Rewriter'
  }, [])

  // Only a dataset with rows can be trained on; the gate has already ensured
  // at least one exists before this page renders.
  const datasets = artifacts.datasets.filter((dataset) => dataset.row_count > 0)
  const selected =
    datasets.find((item) => item.id === params.get('dataset')) ?? datasets[0]
  const run = artifacts.active ?? artifacts.runs[0]
  const { rewardSelection, setRewardSelection } = fineTune
  const allRewards = rewardSelection !== null
  const rewardDatasets = REWARD_IDS.flatMap((reward) => {
    const item = datasets.find(
      (dataset) =>
        dataset.reward === reward && dataset.id === rewardSelection?.[reward],
    )
    return item ? [item] : []
  })
  const trainingDatasets = allRewards ? rewardDatasets : selected ? [selected] : []
  const source = trainingDatasets[0]
  const enoughDatasets =
    trainingDatasets.length === (allRewards ? REWARD_IDS.length : 1)

  const benchmark = evaluation.benchmark
  const seed = source?.provenance.settings?.seed
  const preset =
    benchmark &&
    seed !== undefined &&
    benchmark.seeds.includes(seed) &&
    trainingDatasets.every(
      (dataset) =>
        dataset.provenance.settings?.seed === seed &&
        hasBenchmarkSource(dataset.provenance, benchmark),
    )
      ? {
          modelId: benchmark.model_id,
          revision: benchmark.model_revision,
          settings: benchmarkTrainingSettings(benchmark, seed),
        }
      : undefined
  const usePreset = preset && params.get('settings') !== 'custom' ? preset : undefined
  const fullBuild =
    benchmark &&
    enoughDatasets &&
    trainingDatasets.every((dataset) =>
      isFrozenRewardBuild(dataset.provenance, benchmark, dataset.reward),
    )
  const currentSettings = usePreset?.settings ?? fineTune.settings
  const fallback = {
    modelId: source?.provenance.model_id ?? '',
    revision: source?.provenance.model_revision ?? '',
  }
  const chosenModel =
    usePreset?.modelId ?? (fineTune.modelId.trim() || fallback.modelId)
  const chosenRevision =
    usePreset?.revision ??
    (fineTune.revision.trim() ||
      (chosenModel === fallback.modelId ? fallback.revision : ''))
  const { submitting, queue } = fineTune
  const problems = usePreset ? invalidSettings(currentSettings) : fineTune.problems
  // One run at a time: the backend holds a single training worker.
  const running = artifacts.active !== undefined
  const busy = submitting || running || rewardBuild.busy || Boolean(evaluation.active)
  const blocked = health.state === 'offline'
  const device = model.info?.llm_device

  return (
    <div className={styles.page}>
      <div>
        <h1>Fine-tuning</h1>
        <p className={styles.lede}>
          Train a LoRA adapter on a saved reward dataset. The adapter is the rewriter
          this project is trying to produce, so this is the step the results are
          measured against.
        </p>
      </div>

      {blocked ? (
        <Callout tone="error" title="Can't reach the backend">
          <Button size="sm" icon="refresh" onClick={() => void health.refresh()}>
            Try again
          </Button>
        </Callout>
      ) : null}

      {artifacts.error ? (
        <Callout tone="warn" title="Couldn't refresh what's saved">
          <p>{artifacts.error}</p>
          <Button size="sm" icon="refresh" onClick={() => void artifacts.refresh()}>
            Try again
          </Button>
        </Callout>
      ) : null}

      <Panel>
        <PanelHeader
          title="Start a run"
          description="Train on one saved dataset or select one for each reward."
          aside={
            <ButtonLink size="sm" variant="ghost" to="/artifacts" icon="layers">
              Artifacts
            </ButtonLink>
          }
        />

        <PanelSection>
          <div className={styles.form}>
            <CheckGroup
              legend="Training scope"
              options={[{ value: 'all', label: 'Fine-tune all four rewards' }]}
              selected={allRewards ? ['all'] : []}
              disabled={busy}
              onToggle={() =>
                setRewardSelection(
                  allRewards
                    ? null
                    : Object.fromEntries(
                        datasets
                          .filter((item) => item.build_id === selected?.build_id)
                          .map((item) => [item.reward, item.id]),
                      ),
                )
              }
            />
            {allRewards ? (
              <div className={styles.rewardDatasets}>
                {REWARD_IDS.map((reward) => {
                  const options = datasets.filter(
                    (dataset) => dataset.reward === reward,
                  )
                  const chosen = options.find(
                    (dataset) => dataset.id === rewardSelection[reward],
                  )
                  return (
                    <SelectField
                      key={reward}
                      label={`${reward.toUpperCase()} dataset`}
                      value={chosen?.id ?? ''}
                      disabled={busy || options.length === 0}
                      hint={
                        options.length === 0
                          ? 'No saved dataset with training rows.'
                          : undefined
                      }
                      onChange={(event) => {
                        const id = event.target.value
                        setRewardSelection((current) =>
                          current === null ? null : { ...current, [reward]: id },
                        )
                      }}
                    >
                      <option value="">Choose a dataset</option>
                      {options.map((item) => (
                        <option key={item.id} value={item.id}>
                          {datasetLabel(item)}
                        </option>
                      ))}
                    </SelectField>
                  )
                })}
              </div>
            ) : (
              <SelectField
                label="Saved dataset"
                value={selected?.id ?? ''}
                disabled={busy}
                hint={
                  selected
                    ? `${count(selected.row_count)} kept rewrites from ${selected.reward.toUpperCase()}.`
                    : undefined
                }
                onChange={(event) =>
                  setParams(
                    (current) => {
                      const next = new URLSearchParams(current)
                      next.set('dataset', event.target.value)
                      return next
                    },
                    { replace: true },
                  )
                }
              >
                {datasets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.reward.toUpperCase()}
                    {item.provenance.settings?.seed !== undefined
                      ? ` · Seed ${item.provenance.settings.seed}`
                      : ''}
                    {' · '}
                    {count(item.row_count)} rows
                  </option>
                ))}
              </SelectField>
            )}

            {preset ? (
              <OptionChips
                legend="Training preset"
                options={[
                  { value: 'benchmark', label: 'Benchmark' },
                  { value: 'custom', label: 'Custom' },
                ]}
                selected={usePreset ? 'benchmark' : 'custom'}
                disabled={busy}
                onPick={(settings) =>
                  setParams(
                    (current) => {
                      const next = new URLSearchParams(current)
                      next.set('settings', settings)
                      return next
                    },
                    { replace: true },
                  )
                }
                hint={
                  usePreset
                    ? `Uses seed ${seed} from the selected ${allRewards ? 'datasets' : 'dataset'}. ${
                        fullBuild
                          ? 'Official results require matching CUDA training runs for all four rewards and every benchmark seed.'
                          : 'This dataset can be used for a validation pilot.'
                      }`
                    : undefined
                }
              />
            ) : null}

            <div className={styles.fields}>
              <TextField
                label="Base model"
                value={usePreset?.modelId ?? fineTune.modelId}
                maxLength={193}
                spellCheck={false}
                autoComplete="off"
                disabled={busy || Boolean(usePreset)}
                placeholder={fallback.modelId || 'Backend default'}
                onChange={(event) => fineTune.setModelId(event.target.value)}
                hint={
                  usePreset
                    ? undefined
                    : fallback.modelId
                      ? `Blank uses ${fallback.modelId} as the base model.`
                      : 'Blank uses the backend default.'
                }
              />
              <TextField
                label="Revision"
                value={usePreset?.revision ?? fineTune.revision}
                maxLength={200}
                spellCheck={false}
                autoComplete="off"
                disabled={busy || Boolean(usePreset)}
                placeholder={chosenRevision || 'Latest'}
                onChange={(event) => fineTune.setRevision(event.target.value)}
              />
              <TextField
                label="Run name"
                value={fineTune.name}
                maxLength={120}
                disabled={busy}
                placeholder="Named for you if blank"
                onChange={(event) => fineTune.setName(event.target.value)}
              />
            </div>

            <Disclosure summary="Training settings" count={`${KNOBS.length} values`}>
              <div className={styles.fields}>
                {KNOBS.map(({ key, label, hint }) => {
                  const [low, high] = TRAINING_LIMITS[key]
                  const problem = problems.get(key)
                  const rate = key === 'learningRate'
                  return (
                    <TextField
                      key={key}
                      label={label}
                      type="number"
                      inputMode={rate ? 'decimal' : 'numeric'}
                      min={low}
                      max={high}
                      step={rate ? 0.0001 : 1}
                      value={currentSettings[key]}
                      disabled={busy || Boolean(usePreset)}
                      error={problem}
                      hint={
                        problem
                          ? undefined
                          : (hint ?? `Default ${TRAINING_DEFAULTS[key]}.`)
                      }
                      onChange={(event) =>
                        fineTune.update(key, Number(event.target.value))
                      }
                    />
                  )
                })}
              </div>
            </Disclosure>
          </div>
        </PanelSection>

        <PanelBody>
          {fineTune.state.status === 'failed' ? (
            <Callout
              tone="error"
              title={queue ? 'Fine-tuning sequence stopped' : "Couldn't start the run"}
              role="alert"
            >
              <p>{fineTune.state.error}</p>
              {queue && queue.completed > 0 ? (
                <p>
                  {queue.completed} of {queue.total} adapters were saved.
                </p>
              ) : null}
            </Callout>
          ) : null}

          {queue && submitting ? (
            <Callout tone="info" icon="refresh">
              Training {queue.reward.toUpperCase()} · {queue.completed} of {queue.total}{' '}
              adapters saved. Keep the app open until all four finish.
            </Callout>
          ) : running ? (
            <Callout tone="info" icon="refresh">
              A run is already training. The backend takes one at a time.
            </Callout>
          ) : null}

          {queue &&
          fineTune.state.status === 'done' &&
          queue.completed === queue.total ? (
            <Callout tone="info">
              All four adapters were saved.{' '}
              <ButtonLink variant="ghost" size="sm" to="/artifacts">
                View artifacts
              </ButtonLink>
            </Callout>
          ) : null}

          {evaluation.active ? (
            <Callout tone="info" icon="refresh">
              Wait for the active evaluation before fine-tuning.
            </Callout>
          ) : null}

          {rewardBuild.busy ? (
            <Callout tone="info" icon="refresh">
              Wait for the active dataset build before fine-tuning.
            </Callout>
          ) : null}

          <div className={styles.actions}>
            <Button
              variant="primary"
              icon="arrow"
              busy={submitting}
              disabled={busy || blocked || !enoughDatasets || problems.size > 0}
              onClick={() => {
                if (!enoughDatasets) return
                if (allRewards) {
                  void fineTune.startAllRewards(rewardDatasets, {
                    modelId: chosenModel,
                    revision: chosenRevision,
                    settings: currentSettings,
                  })
                } else if (selected) {
                  void fineTune.start(selected.id, fallback, usePreset)
                }
              }}
            >
              {allRewards ? 'Start fine-tuning all four' : 'Start fine-tuning'}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={fineTune.reset}>
              Reset
            </Button>
            <p className={styles.estimate}>
              {allRewards && !enoughDatasets
                ? 'Select one saved dataset for each reward.'
                : enoughDatasets
                  ? `${count(trainingDatasets.reduce((total, dataset) => total + dataset.row_count, 0))} rows × ${currentSettings.epochs} epoch${currentSettings.epochs === 1 ? '' : 's'}${device ? ` · ${device.toUpperCase()} backend` : ''}.`
                  : null}
            </p>
          </div>
          {allRewards && enoughDatasets && !submitting ? (
            <p className={styles.estimate}>
              Trains R0–R3 in order using seed {currentSettings.seed}.
            </p>
          ) : null}
        </PanelBody>
      </Panel>

      {run ? <RunProgress run={run} /> : null}
    </div>
  )
}
