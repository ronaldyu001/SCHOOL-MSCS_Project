import { useEffect } from 'react'
import { useSearchParams } from 'react-router'
import {
  Button,
  ButtonLink,
  Callout,
  Disclosure,
  Panel,
  PanelBody,
  PanelHeader,
  PanelSection,
  SelectField,
  TextField,
} from '@/components/ui'
import { useShell } from '@/app/shell-context'
import { TRAINING_DEFAULTS, TRAINING_LIMITS, type TrainingSettings } from '@/lib/api'
import { count } from '@/lib/format'
import { RunProgress } from './RunProgress'
import styles from './FineTuningPage.module.css'

/** The advanced numeric settings, in the order they matter to a reader. */
const KNOBS: { key: keyof TrainingSettings; label: string; hint?: string }[] = [
  { key: 'epochs', label: 'Epochs', hint: 'Passes over the dataset.' },
  { key: 'learningRate', label: 'Learning rate' },
  { key: 'batchSize', label: 'Batch size' },
  { key: 'gradientAccumulationSteps', label: 'Gradient accumulation' },
  { key: 'maxLength', label: 'Max tokens', hint: 'Longer examples are truncated.' },
  { key: 'loraRank', label: 'LoRA rank' },
  { key: 'loraAlpha', label: 'LoRA alpha' },
  { key: 'seed', label: 'Seed' },
]

export function FineTuningPage() {
  const { artifacts, fineTune, health } = useShell()
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

  const fallback = {
    modelId: selected?.provenance.model_id ?? '',
    revision: selected?.provenance.model_revision ?? '',
  }
  const chosenModel = fineTune.modelId.trim() || fallback.modelId
  const { problems, submitting } = fineTune
  // One run at a time: the backend holds a single training worker.
  const running = artifacts.active !== undefined
  const busy = submitting || running
  const blocked = health.state === 'offline'

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
          description="Pick a dataset and train. Defaults come from the backend's configuration."
          aside={
            <ButtonLink size="sm" variant="ghost" to="/artifacts" icon="layers">
              Artifacts
            </ButtonLink>
          }
        />

        <PanelSection>
          <div className={styles.form}>
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
                setParams({ dataset: event.target.value }, { replace: true })
              }
            >
              {datasets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.reward.toUpperCase()} · {count(item.row_count)}{' '}
                  rows
                </option>
              ))}
            </SelectField>

            <div className={styles.fields}>
              <TextField
                label="Base model"
                value={fineTune.modelId}
                maxLength={193}
                spellCheck={false}
                autoComplete="off"
                disabled={busy}
                placeholder={fallback.modelId || 'Backend default'}
                onChange={(event) => fineTune.setModelId(event.target.value)}
                hint={
                  fallback.modelId
                    ? `Blank trains ${fallback.modelId}, which wrote this dataset.`
                    : 'Blank uses the backend default.'
                }
              />
              <TextField
                label="Revision"
                value={fineTune.revision}
                maxLength={200}
                spellCheck={false}
                autoComplete="off"
                disabled={busy}
                placeholder={
                  (chosenModel === fallback.modelId && fallback.revision) || 'Latest'
                }
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
                      value={fineTune.settings[key]}
                      disabled={busy}
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
            <Callout tone="error" title="Couldn't start the run" role="alert">
              <p>{fineTune.state.error}</p>
            </Callout>
          ) : null}

          {running ? (
            <Callout tone="info" icon="refresh">
              A run is already training. The backend takes one at a time.
            </Callout>
          ) : null}

          <div className={styles.actions}>
            <Button
              variant="primary"
              icon="arrow"
              busy={submitting}
              disabled={busy || blocked || !selected || problems.size > 0}
              onClick={() => void fineTune.start(selected?.id ?? '', fallback)}
            >
              Start fine-tuning
            </Button>
            <Button variant="ghost" disabled={busy} onClick={fineTune.reset}>
              Reset
            </Button>
            <p className={styles.estimate}>
              {selected
                ? `${count(selected.row_count)} rows × ${fineTune.settings.epochs} epoch${fineTune.settings.epochs === 1 ? '' : 's'} on CPU. Expect this to be slow.`
                : null}
            </p>
          </div>
        </PanelBody>
      </Panel>

      {run ? <RunProgress run={run} /> : null}
    </div>
  )
}
