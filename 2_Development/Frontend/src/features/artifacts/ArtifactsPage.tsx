import { useEffect, useState } from 'react'
import {
  Button,
  ButtonLink,
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
  sourceName,
}: {
  item: SavedRewardDataset | TrainingRun
  refresh: () => Promise<void>
  inUse?: boolean
  sourceName?: string
}) {
  const dataset = 'row_count' in item ? item : null
  const run = 'status' in item ? item : null
  const kind = dataset ? 'datasets' : 'runs'
  const [name, setName] = useState(item.name)
  const [notes, setNotes] = useState(item.notes)
  const [pending, setPending] = useState<'save' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const active = inUse || (run !== null && isActiveRun(run))
  const downloadable = dataset !== null || run?.status === 'completed'

  async function apply(action: 'save' | 'delete') {
    setPending(action)
    setError(null)
    try {
      if (action === 'delete') await deleteArtifact(kind, item.id)
      else await updateArtifact(kind, item.id, { name: name.trim(), notes })
      setConfirmDelete(false)
      await refresh()
    } catch (problem) {
      setError(describeError(problem))
    } finally {
      setPending(null)
    }
  }

  const provenance = dataset?.provenance ?? run?.dataset_provenance
  const seed = dataset?.provenance.settings?.seed ?? run?.settings.seed
  const limit = provenance?.settings?.max_inputs_per_reward
  const scope =
    limit === null
      ? 'Full training split'
      : limit !== undefined
        ? `Pilot · up to ${count(limit)} inputs/reward`
        : 'Scope not recorded'
  const rewardNames = {
    r0: 'Supervised ceiling',
    r1: 'Full-context teacher',
    r2: 'Masked-turn prediction',
    r3: 'Synthetic evidence',
  }
  return (
    <article className={styles.card}>
      <div className={styles.cardHeader}>
        <h3>{item.name}</h3>
        <span>
          {dataset
            ? `${count(dataset.row_count)} training ${dataset.row_count === 1 ? 'row' : 'rows'}`
            : run?.status}
        </span>
      </div>
      <p className={styles.facts}>
        <strong>
          {item.reward.toUpperCase()} · {rewardNames[item.reward]}
        </strong>
        <span>{scope}</span>
        {seed !== undefined ? <span>Seed {seed}</span> : null}
        <time dateTime={item.created_at}>
          {new Date(item.created_at).toLocaleString()}
        </time>
        <span>{item.id.slice(0, 8)}</span>
      </p>
      <p className={styles.facts}>
        {dataset?.provenance.model_id ?? run?.model_id ?? 'Model not recorded'}
        {provenance?.rewrite_generator?.provider === 'openai' ? (
          <span>Rewrite generator {provenance.rewrite_generator.model_id}</span>
        ) : null}
        {item.reward === 'r1' && provenance?.r1_teacher?.provider === 'openai' ? (
          <span>Full-history teacher {provenance.r1_teacher.model_id}</span>
        ) : null}
      </p>
      {sourceName ? <p className={styles.facts}>Source dataset: {sourceName}</p> : null}
      {item.notes ? <p className={styles.notes}>{item.notes}</p> : null}
      {dataset?.row_count === 0 ? (
        <Callout title="No training examples">
          This build kept no winning rewrites and cannot be used for fine-tuning.
        </Callout>
      ) : null}
      <Disclosure summary="Details and actions">
        <div className={styles.editor}>
          <p className={styles.facts}>
            <time dateTime={item.created_at}>
              {new Date(item.created_at).toLocaleString()}
            </time>
            <CopyValue value={item.id} label={dataset ? 'Dataset ID' : 'Run ID'} />
            {run ? <span>Base model {run.model_id}</span> : null}
            {run ? (
              <CopyValue value={run.dataset_id} label="Source dataset ID" />
            ) : null}
            {dataset?.provenance.model_id ? (
              <span>Model {dataset.provenance.model_id}</span>
            ) : null}
            {dataset?.provenance.settings?.keep_all_one_ties &&
            dataset.reward === 'r0' ? (
              <span>
                {count(dataset.summary.kept_all_one_ties ?? 0)} all-one ties kept
              </span>
            ) : null}
            {dataset?.provenance.settings?.keep_single_rewrite ? (
              <span>{count(dataset.summary.kept_single_rewrites ?? 0)} single rewrites kept</span>
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
              <ButtonLink
                size="sm"
                icon="copy"
                href={artifactDownloadUrl(kind, item.id)}
              >
                Download ZIP
              </ButtonLink>
            ) : null}
            {dataset && dataset.row_count > 0 ? (
              <ButtonLink
                size="sm"
                icon="arrow"
                to={`/fine-tuning?dataset=${encodeURIComponent(dataset.id)}`}
              >
                Use for fine-tuning
              </ButtonLink>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              busy={pending === 'delete'}
              disabled={pending !== null || active}
              title={active ? 'Available after the active run ends' : undefined}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          </div>
          {confirmDelete ? (
            <Callout tone="error" title={`Delete “${item.name}”?`} role="alert">
              <p>This permanently removes this saved artifact and its files.</p>
              <div className={styles.actions}>
                <Button
                  size="sm"
                  disabled={pending !== null}
                  onClick={() => setConfirmDelete(false)}
                >
                  Keep artifact
                </Button>
                <Button
                  size="sm"
                  busy={pending === 'delete'}
                  disabled={pending !== null || active}
                  onClick={() => void apply('delete')}
                >
                  Delete permanently
                </Button>
              </div>
            </Callout>
          ) : null}
        </div>
      </Disclosure>
    </article>
  )
}

export function ArtifactsPage() {
  const { artifacts, evaluation } = useShell()
  const { refresh } = artifacts
  const [search, setSearch] = useState('')
  const matches = (item: SavedRewardDataset | TrainingRun) =>
    JSON.stringify(item).toLowerCase().includes(search.trim().toLowerCase())
  const datasets = artifacts.datasets.filter(matches)
  const runs = artifacts.runs.filter(matches)
  const adaptersInUse = new Set(
    Object.values(evaluation.active?.adapters ?? {}).flatMap((seed) =>
      seed ? Object.values(seed).map((source) => source.run_id) : [],
    ),
  )
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
      <TextField
        label="Find an artifact"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Name, notes, reward, seed, model, or ID"
      />
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
          aside={
            <ButtonLink size="sm" variant="ghost" to="/training" icon="refresh">
              Build dataset
            </ButtonLink>
          }
        />
        <PanelBody>
          {datasets.length ? (
            <div className={styles.list}>
              {datasets.map((dataset) => (
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
              {artifacts.checked
                ? search
                  ? 'No matching reward datasets.'
                  : 'No saved reward datasets.'
                : 'Loading datasets…'}
            </p>
          )}
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHeader
          title="Training runs and adapters"
          aside={
            <ButtonLink size="sm" variant="ghost" to="/fine-tuning" icon="split">
              Fine-tune
            </ButtonLink>
          }
        />
        <PanelBody>
          {runs.length ? (
            <div className={styles.list}>
              {runs.map((run) => (
                <ArtifactEditor
                  key={run.id}
                  item={run}
                  refresh={refresh}
                  inUse={adaptersInUse.has(run.id)}
                  sourceName={
                    artifacts.datasets.find((dataset) => dataset.id === run.dataset_id)
                      ?.name
                  }
                />
              ))}
            </div>
          ) : (
            <p>
              {artifacts.checked
                ? search
                  ? 'No matching training runs.'
                  : 'No training runs.'
                : 'Loading training runs…'}
            </p>
          )}
        </PanelBody>
      </Panel>
    </div>
  )
}
