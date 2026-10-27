import {
  Button,
  ChipList,
  CopyValue,
  Disclosure,
  Stat,
  StatGrid,
  TextField,
} from '@/components/ui'
import { count, ratio } from '@/lib/format'
import { PhaseCard, PhaseControls, Readout } from '../PhaseCard'
import { statusOf, type usePipeline } from '../usePipeline'

export function LoadPhase({ pipeline }: { pipeline: ReturnType<typeof usePipeline> }) {
  const { state, settings, update, busy } = pipeline
  const run = state.load
  const result = run.status === 'done' ? run.result : null

  return (
    <PhaseCard
      id="phase-load"
      step={1}
      title="Load the dataset"
      purpose="Parse LoCoMo into conversations and questions, and hold them in backend memory under a dataset id the later phases refer to."
      endpoint="POST /data/load"
      status={statusOf(run, false)}
      startedAt={run.status === 'running' ? run.startedAt : null}
      elapsedMs={
        run.status === 'done' || run.status === 'failed' ? run.elapsedMs : undefined
      }
      error={run.status === 'failed' ? run.error : undefined}
      runningNote="Reading the JSON and building conversations, sessions, turns and QA entries. Nothing is embedded at this stage."
      controls={
        <PhaseControls
          inputs={
            <TextField
              label="Dataset path"
              labelNote="backend filesystem"
              value={settings.path}
              spellCheck={false}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => update('path', event.target.value)}
              hint="Resolved by the backend, not the browser. Under docker-compose the dataset is mounted read-only at /data; running the backend directly, use a path relative to the Backend directory such as ../.data/locomo10.json."
            />
          }
          action={
            <Button
              variant="primary"
              icon="layers"
              busy={run.status === 'running'}
              disabled={busy || settings.path.trim() === ''}
              onClick={() => void pipeline.runLoad(settings.path.trim())}
            >
              {run.status === 'done' ? 'Reload dataset' : 'Load dataset'}
            </Button>
          }
        />
      }
      insight={
        result ? (
          <>
            <StatGrid>
              <Stat
                label="Conversations"
                value={count(result.conversation_count)}
                hint="Each is a multi-session history between two speakers."
                onSunken
                accent
              />
              <Stat
                label="Questions"
                value={count(result.qa_count)}
                hint="Across all categories, before any filtering."
                onSunken
              />
              <Stat
                label="Questions per conversation"
                value={ratio(result.qa_count, result.conversation_count)}
                hint="Mean. Evaluation reports per category, not per conversation."
                onSunken
              />
              <Stat
                label="Dataset id"
                value={<CopyValue value={result.dataset_id} label="dataset id" />}
                text
                hint="Lives in backend app state; a restart drops it."
                onSunken
              />
            </StatGrid>

            <Readout>
              Parsed <strong>{count(result.conversation_count)}</strong> conversations
              and <strong>{count(result.qa_count)}</strong> questions. Everything
              downstream works at conversation granularity, so a conversation is
              assigned to exactly one partition and its questions travel with it — that
              is what keeps the test split genuinely held out. Question categories are
              not counted here; they are only resolved once the filter is applied in
              phase 3.
            </Readout>

            <Disclosure
              summary="Conversation ids"
              count={`${result.conversation_ids.length} total`}
            >
              <ChipList
                items={result.conversation_ids}
                label="Loaded conversation ids"
              />
            </Disclosure>
          </>
        ) : null
      }
    />
  )
}
