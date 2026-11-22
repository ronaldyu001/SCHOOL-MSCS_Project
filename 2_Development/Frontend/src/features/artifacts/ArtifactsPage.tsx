import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  Button,
  Callout,
  CopyValue,
  Disclosure,
  Panel,
  PanelBody,
  PanelHeader,
  TextAreaField,
  TextField,
} from '@/components/ui'
import { useShell } from '@/app/shell-context'
import {
  artifactDownloadUrl,
  deleteArtifact,
  updateArtifact,
  type SavedRewardDataset,
  type TrainingRun,
} from '@/lib/api'
import { count } from '@/lib/format'
import { describeError } from '@/lib/useAsyncRun'
import { isActiveRun } from './useArtifacts'
import styles from './ArtifactsPage.module.css'

function ArtifactEditor({
  item,
  refresh,
  inUse = false,
}: {
  item: SavedRewardDataset | TrainingRun
  refresh: () => Promise<void>
  inUse?: boolean
}) {
  const dataset = 'row_count' in item ? item : null
  const run = 'status' in item ? item : null
  const kind = dataset ? 'datasets' : 'runs'
  const [name, setName] = useState(item.name)
  const [notes, setNotes] = useState(item.notes)
  const [pending, setPending] = useState<'save' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const active = inUse || (run !== null && isActiveRun(run))
  const downloadable = dataset !== null || run?.status === 'completed'

  async function apply(action: 'save' | 'delete') {
    if (
      action === 'delete' &&
      !window.confirm(`Delete “${item.name}” from saved artifacts?`)
    )
      return
    setPending(action)
    setError(null)
    try {
      if (action === 'delete') await deleteArtifact(kind, item.id)
      else await updateArtifact(kind, item.id, { name: name.trim(), notes })
      await refresh()
    } catch (problem) {
      setError(describeError(problem))
    } finally {
      setPending(null)
    }
  }

  const summary = dataset
    ? `${dataset.reward.toUpperCase()} · ${count(dataset.row_count)} rows`
    : `${item.reward.toUpperCase()} · ${run?.status}`
  return (
    <Disclosure summary={item.name} count={summary}>
      <div className={styles.editor}>
        <p className={styles.facts}>
          <time dateTime={item.created_at}>
            {new Date(item.created_at).toLocaleString()}
          </time>
          <CopyValue value={item.id} label={dataset ? 'Dataset ID' : 'Run ID'} />
          {run ? <span>Base model {run.model_id}</span> : null}
          {run ? <CopyValue value={run.dataset_id} label="Source dataset ID" /> : null}
          {dataset?.provenance.model_id ? (
            <span>Model {dataset.provenance.model_id}</span>
          ) : null}
          {dataset?.provenance.settings?.keep_all_one_ties &&
          dataset.reward === 'r0' ? (
            <span>
              {count(dataset.summary.kept_all_one_ties ?? 0)} all-one ties kept
            </span>
          ) : null}
        </p>
        {run?.error ? <Callout tone="error">{run.error}</Callout> : null}
        {error ? (
          <Callout tone="error" role="alert">
            {error}
          </Callout>
        ) : null}
        <TextField
          label="Name"
          value={name}
          maxLength={120}
          disabled={pending !== null}
          onChange={(event) => setName(event.target.value)}
        />
        <TextAreaField
          label="Notes"
          value={notes}
          maxLength={4000}
          rows={2}
          disabled={pending !== null}
          onChange={(event) => setNotes(event.target.value)}
        />
        <div className={styles.actions}>
          <Button
            size="sm"
            busy={pending === 'save'}
            disabled={
              pending !== null ||
              !name.trim() ||
              (name.trim() === item.name && notes === item.notes)
            }
            onClick={() => void apply('save')}
          >
            Save changes
          </Button>
          {downloadable ? (
            <a href={artifactDownloadUrl(kind, item.id)}>Download ZIP</a>
          ) : null}
          {dataset && dataset.row_count > 0 ? (
            <Link to={`/fine-tuning?dataset=${encodeURIComponent(dataset.id)}`}>
              Use for fine-tuning
            </Link>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            busy={pending === 'delete'}
            disabled={pending !== null || active}
            title={active ? 'Available after the training run ends' : undefined}
            onClick={() => void apply('delete')}
          >
            Delete
          </Button>
        </div>
      </div>
    </Disclosure>
  )
}

export function ArtifactsPage() {
  const { artifacts } = useShell()
  const { refresh } = artifacts
  useEffect(() => {
    document.title = 'Artifacts · Memory Query Rewriter'
  }, [])

  return (
    <div className={styles.page}>
      <div>
        <h1>Artifacts</h1>
        <p className={styles.lede}>
          Manage saved reward datasets and fine-tuning runs.
        </p>
      </div>
      {artifacts.error ? (
        <Callout title="Couldn’t load saved artifacts" tone="error">
          <p>{artifacts.error}</p>
          <Button size="sm" onClick={() => void artifacts.refresh()}>
            Try again
          </Button>
        </Callout>
      ) : null}
      <Panel>
        <PanelHeader
          title="Reward datasets"
          aside={<Link to="/training">Build dataset</Link>}
        />
        <PanelBody>
          {artifacts.datasets.length ? (
            <div className={styles.list}>
              {artifacts.datasets.map((dataset) => (
                <ArtifactEditor
                  key={dataset.id}
                  item={dataset}
                  refresh={refresh}
                  inUse={artifacts.active?.dataset_id === dataset.id}
                />
              ))}
            </div>
          ) : (
            <p>
              {artifacts.checked ? 'No saved reward datasets.' : 'Loading datasets…'}
            </p>
          )}
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHeader
          title="Training runs and adapters"
          aside={<Link to="/fine-tuning">Fine-tune</Link>}
        />
        <PanelBody>
          {artifacts.runs.length ? (
            <div className={styles.list}>
              {artifacts.runs.map((run) => (
                <ArtifactEditor key={run.id} item={run} refresh={refresh} />
              ))}
            </div>
          ) : (
            <p>{artifacts.checked ? 'No training runs.' : 'Loading training runs…'}</p>
          )}
        </PanelBody>
      </Panel>
    </div>
  )
}
