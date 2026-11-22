import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useShell } from '@/app/shell-context'
import {
  Button,
  Callout,
  Panel,
  PanelBody,
  PanelHeader,
  SelectField,
  TextField,
} from '@/components/ui'
import { artifactDownloadUrl, startTrainingRun } from '@/lib/api'
import { count } from '@/lib/format'
import { describeError } from '@/lib/useAsyncRun'
import styles from '@/features/artifacts/ArtifactsPage.module.css'

export function FineTuningPage() {
  const { artifacts } = useShell()
  const [params, setParams] = useSearchParams()
  const datasets = artifacts.datasets.filter((dataset) => dataset.row_count > 0)
  const dataset =
    datasets.find((item) => item.id === params.get('dataset')) ?? datasets[0]
  const [modelId, setModelId] = useState('')
  const [revision, setRevision] = useState('')
  const [name, setName] = useState('')
  const [epochs, setEpochs] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = artifacts.active ?? artifacts.runs[0]
  const busy = submitting || artifacts.active !== undefined
  const defaultModel = dataset?.provenance.model_id ?? ''
  const defaultRevision = dataset?.provenance.model_revision ?? ''
  const selectedModel = modelId.trim() || defaultModel

  useEffect(() => {
    document.title = 'Fine-tuning · Memory Query Rewriter'
  }, [])

  async function train(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dataset || busy) return
    setSubmitting(true)
    setError(null)
    try {
      await startTrainingRun({
        datasetId: dataset.id,
        modelId: selectedModel,
        revision:
          revision.trim() || (selectedModel === defaultModel ? defaultRevision : ''),
        name: name.trim(),
        epochs,
      })
      await artifacts.refresh()
    } catch (problem) {
      setError(describeError(problem))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.page}>
      <div>
        <h1>Fine-tuning</h1>
        <p className={styles.lede}>Train a LoRA adapter on a saved reward dataset.</p>
      </div>
      {artifacts.error ? (
        <Callout tone="error" title="Couldn’t refresh saved artifacts">
          <p>{artifacts.error}</p>
          <Button size="sm" onClick={() => void artifacts.refresh()}>
            Try again
          </Button>
        </Callout>
      ) : null}
      <Panel>
        <PanelHeader
          title="New training run"
          aside={<Link to="/artifacts">Manage artifacts</Link>}
        />
        <PanelBody>
          <form className={styles.editor} onSubmit={(event) => void train(event)}>
            <SelectField
              label="Saved dataset"
              value={dataset?.id ?? ''}
              disabled={busy}
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
                value={modelId}
                maxLength={193}
                disabled={busy}
                placeholder={defaultModel || 'Backend default'}
                onChange={(event) => setModelId(event.target.value)}
              />
              <TextField
                label="Revision"
                value={revision}
                maxLength={200}
                disabled={busy}
                placeholder={
                  (selectedModel === defaultModel && defaultRevision) ||
                  'Default revision'
                }
                onChange={(event) => setRevision(event.target.value)}
              />
              <TextField
                label="Run name"
                value={name}
                maxLength={120}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
              <TextField
                label="Epochs"
                type="number"
                min={1}
                max={20}
                required
                value={epochs || ''}
                disabled={busy}
                onChange={(event) => setEpochs(Number(event.target.value))}
              />
            </div>
            {error ? (
              <Callout tone="error" role="alert">
                {error}
              </Callout>
            ) : null}
            <div className={styles.actions}>
              <Button
                type="submit"
                variant="primary"
                busy={submitting}
                disabled={
                  !dataset ||
                  busy ||
                  !Number.isInteger(epochs) ||
                  epochs < 1 ||
                  epochs > 20
                }
              >
                Start fine-tuning
              </Button>
            </div>
          </form>
        </PanelBody>
      </Panel>
      {current ? (
        <Panel>
          <PanelHeader
            title={current.name}
            aside={<span role="status">{current.status}</span>}
          />
          <PanelBody>
            {current.progress.phase ? (
              <p role="status">
                {current.progress.phase.replaceAll('_', ' ')}
                {current.progress.step !== undefined
                  ? ` · Step ${count(current.progress.step)}`
                  : ''}
                {current.progress.total_steps !== undefined
                  ? ` of ${count(current.progress.total_steps)}`
                  : ''}
              </p>
            ) : null}
            {current.error ? <Callout tone="error">{current.error}</Callout> : null}
            {current.status === 'completed' ? (
              <div className={styles.actions}>
                <a href={artifactDownloadUrl('runs', current.id)}>Download adapter</a>
                <Link to="/evaluation">Continue to Results</Link>
              </div>
            ) : null}
          </PanelBody>
        </Panel>
      ) : null}
    </div>
  )
}
