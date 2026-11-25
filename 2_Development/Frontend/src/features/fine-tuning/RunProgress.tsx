import {
  ButtonLink,
  Callout,
  MetricBar,
  Panel,
  PanelBody,
  PanelHeader,
  Stat,
  StatGrid,
  StatusBadge,
} from '@/components/ui'
import type { PhaseStatus } from '@/components/ui'
import { artifactDownloadUrl, type TrainingRun } from '@/lib/api'
import { count, duration } from '@/lib/format'
import styles from './FineTuningPage.module.css'

/** Run status in the badge vocabulary the rest of the app already uses. */
const BADGE: Record<TrainingRun['status'], { status: PhaseStatus; label: string }> = {
  queued: { status: 'idle', label: 'Queued' },
  running: { status: 'running', label: 'Training' },
  completed: { status: 'done', label: 'Finished' },
  failed: { status: 'failed', label: 'Failed' },
  interrupted: { status: 'failed', label: 'Interrupted' },
}

/** The three phases the trainer reports, in words rather than identifiers. */
const PHASE: Record<string, string> = {
  loading_model: 'Loading the base model',
  training: 'Training',
  saving_adapter: 'Saving the adapter',
}

function phaseLabel(phase: string | undefined) {
  if (!phase) return null
  return PHASE[phase] ?? phase.replaceAll('_', ' ')
}

/**
 * Metrics arrive as a free-form map, so the known ones are formatted and the
 * rest are printed as they come. Seconds become a duration because "912.4" is
 * not a length of time anybody reads at a glance.
 */
function metricLabel(key: string) {
  // The unit moves into the value when it is formatted as a duration, so the
  // label should not still claim seconds.
  return key.replace(/_seconds$/, '').replaceAll('_', ' ')
}

function metricValue(key: string, value: number) {
  if (key.endsWith('_seconds')) return duration(value * 1000)
  if (Number.isInteger(value)) return count(value)
  return value.toFixed(4)
}

export function RunProgress({ run }: { run: TrainingRun }) {
  const badge = BADGE[run.status]
  const { phase, step, total_steps: total, loss } = run.progress
  const stepped = step !== undefined && total !== undefined && total > 0
  const active = run.status === 'queued' || run.status === 'running'
  const metrics = Object.entries(run.metrics)

  return (
    <Panel>
      <PanelHeader
        titleAs="h2"
        eyebrow="Latest run"
        title={run.name}
        description={`Adapter for ${run.model_id}`}
        aside={<StatusBadge status={badge.status} label={badge.label} />}
      />
      <PanelBody>
        {active ? (
          <p className={styles.phase} role="status">
            {phaseLabel(phase) ?? 'Waiting to start'}
            {stepped ? ` · step ${count(step)} of ${count(total)}` : null}
            {loss !== undefined ? ` · loss ${loss.toFixed(4)}` : null}
          </p>
        ) : null}

        {active && stepped ? (
          <MetricBar
            caption="Progress"
            max={total}
            rows={[
              {
                key: 'steps',
                label: 'Steps',
                value: step,
                readout: `${count(step)} / ${count(total)}`,
              },
            ]}
          />
        ) : null}

        {run.error ? (
          <Callout tone="error" title="The run stopped" role="alert">
            <p>{run.error}</p>
          </Callout>
        ) : null}

        {metrics.length > 0 ? (
          <StatGrid>
            {metrics.map(([key, value]) => (
              <Stat
                key={key}
                label={metricLabel(key)}
                value={metricValue(key, value)}
                text={key.endsWith('_seconds')}
              />
            ))}
          </StatGrid>
        ) : null}

        {run.status === 'completed' ? (
          <p className={styles.actions}>
            <ButtonLink
              href={artifactDownloadUrl('runs', run.id)}
              variant="primary"
              icon="copy"
            >
              Download the adapter
            </ButtonLink>
            <ButtonLink to="/artifacts" variant="ghost" icon="layers">
              All artifacts
            </ButtonLink>
            <ButtonLink to="/evaluation" variant="ghost" icon="arrow">
              Open Results
            </ButtonLink>
          </p>
        ) : null}
      </PanelBody>
    </Panel>
  )
}
