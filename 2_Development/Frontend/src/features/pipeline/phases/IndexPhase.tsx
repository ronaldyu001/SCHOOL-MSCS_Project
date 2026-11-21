import {
  Button,
  Callout,
  CopyValue,
  SelectField,
  Stat,
  StatGrid,
  TextField,
} from '@/components/ui'
import { PARTITIONS, type Partition } from '@/lib/api'
import { bytes, count, ratio } from '@/lib/format'
import { PhaseCard, PhaseControls, Readout } from '../PhaseCard'
import { statusOf, type usePipeline } from '../usePipeline'

export function IndexPhase({ pipeline }: { pipeline: ReturnType<typeof usePipeline> }) {
  const { state, settings, update, busy } = pipeline
  const run = state.index
  const result = run.status === 'done' ? run.result : null
  const prepared = state.prepare.status === 'done' ? state.prepare.result : null
  const selected = prepared?.partitions[settings.partition]

  // Vectors only; payload text and the HNSW graph are on top of this.
  const footprint = result ? result.indexed_memory_count * result.vector_size * 4 : 0

  return (
    <PhaseCard
      id="phase-index"
      step={4}
      title="Index into the memory store"
      purpose="Turn every message into a searchable memory."
      status={statusOf(run, prepared === null)}
      blockedReason={prepared ? undefined : 'Prepare the partitions first.'}
      startedAt={run.status === 'running' ? run.startedAt : null}
      elapsedMs={
        run.status === 'done' || run.status === 'failed' ? run.elapsedMs : undefined
      }
      error={run.status === 'failed' ? run.error : undefined}
      runningNote="Embedding on CPU. The first run downloads the encoder, so expect minutes."
      controls={
        <PhaseControls
          inputs={
            <>
              <SelectField
                label="Partition"
                labelNote="one per run"
                value={settings.partition}
                disabled={busy || !prepared}
                onChange={(event) =>
                  update('partition', event.target.value as Partition)
                }
                hint={
                  selected
                    ? `${count(selected.conversation_count)} conversations, ${count(selected.qa_count)} questions.`
                    : 'Indexing covers one partition at a time.'
                }
              >
                {PARTITIONS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                    {prepared
                      ? ` — ${prepared.partitions[name].conversation_count} conversations`
                      : ''}
                  </option>
                ))}
              </SelectField>
              <TextField
                label="Batch size"
                labelNote="memories per upsert"
                type="number"
                min={1}
                value={settings.batchSize}
                disabled={busy || !prepared}
                onChange={(event) => update('batchSize', Number(event.target.value))}
              />
            </>
          }
          action={
            <Button
              variant="primary"
              icon="layers"
              busy={run.status === 'running'}
              disabled={busy || !prepared || settings.batchSize < 1}
              onClick={() => {
                if (!prepared) return
                void pipeline.runIndex(
                  prepared.dataset_id,
                  prepared.prepared_id,
                  settings.partition,
                  settings.batchSize,
                )
              }}
            >
              {result ? 'Re-index partition' : 'Index partition'}
            </Button>
          }
        />
      }
      insight={
        result ? (
          <>
            <StatGrid>
              <Stat
                label="Memories indexed"
                value={count(result.indexed_memory_count)}
                onSunken
                accent
              />
              <Stat
                label="Memories per conversation"
                value={ratio(result.indexed_memory_count, result.conversation_count)}
                hint={`Across ${count(result.conversation_count)} conversations in ${result.partition}.`}
                onSunken
              />
              <Stat
                label="Vector size"
                value={count(result.vector_size)}
                unit="dims"
                hint={`≈ ${bytes(footprint)} of float32 vectors, before payloads and the index graph.`}
                onSunken
              />
              <Stat label="Collection" value={result.collection} text onSunken />
            </StatGrid>

            <StatGrid>
              <Stat label="Encoder" value={result.embedding_model} text onSunken />
              <Stat
                label="Pinned revision"
                value={
                  <CopyValue
                    value={result.embedding_revision}
                    label="encoder revision"
                  />
                }
                text
                onSunken
              />
            </StatGrid>

            <Readout>
              Every message is now a searchable memory in{' '}
              <strong>{result.collection}</strong>. The search page can use it.
            </Readout>

            <Callout tone="info" title="Ids are deterministic, so re-indexing is safe">
              A memory's id is derived from its conversation, session and turn, so a
              second run over the same partition overwrites the same points rather than
              duplicating them. Indexing a different partition adds to the same
              collection — retrieval filters by conversation_id, so partitions stay
              separable.
            </Callout>
          </>
        ) : null
      }
    />
  )
}
