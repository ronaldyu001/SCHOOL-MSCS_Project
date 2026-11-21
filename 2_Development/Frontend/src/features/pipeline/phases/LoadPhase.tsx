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
      purpose="Read the LoCoMo file into conversations and questions."
      status={statusOf(run, false)}
      startedAt={run.status === 'running' ? run.startedAt : null}
      elapsedMs={
        run.status === 'done' || run.status === 'failed' ? run.elapsedMs : undefined
      }
      error={run.status === 'failed' ? run.error : undefined}
      runningNote="Reading the file."
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
                onSunken
                accent
              />
              <Stat label="Questions" value={count(result.qa_count)} onSunken />
              <Stat
                label="Questions per conversation"
                value={ratio(result.qa_count, result.conversation_count)}
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
              Read <strong>{count(result.conversation_count)}</strong> conversations and{' '}
              <strong>{count(result.qa_count)}</strong> questions. Questions stay with
              their conversation, so the test split stays genuinely unseen.
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
