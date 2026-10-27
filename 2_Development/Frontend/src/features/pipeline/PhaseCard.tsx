import type { ReactNode } from 'react'
import {
  Callout,
  Icon,
  Panel,
  PanelHeader,
  PanelSection,
  StatusBadge,
  type PhaseStatus,
} from '@/components/ui'
import { duration } from '@/lib/format'
import { useElapsed } from '@/lib/useElapsed'
import styles from './PhaseCard.module.css'

type PhaseCardProps = {
  /** Anchor id, so the rail can jump here. */
  id: string
  step: number
  title: string
  /** What the phase is for, in one sentence. */
  purpose: string
  /** The route this phase calls, shown so the screen stays traceable to the API. */
  endpoint: string
  status: PhaseStatus
  /** Why the phase cannot run yet. Shown instead of leaving a dead button. */
  blockedReason?: string
  /** What the backend is doing, while it runs. */
  runningNote?: string
  startedAt?: number | null
  elapsedMs?: number
  error?: string
  controls: ReactNode
  /** Measured results. Rendered on a recessed band once the phase succeeds. */
  insight?: ReactNode
}

export function PhaseCard({
  id,
  step,
  title,
  purpose,
  endpoint,
  status,
  blockedReason,
  runningNote,
  startedAt,
  elapsedMs,
  error,
  controls,
  insight,
}: PhaseCardProps) {
  const live = useElapsed(status === 'running' ? (startedAt ?? null) : null)
  const headingId = `${id}-heading`

  return (
    <Panel
      id={id}
      className={styles.card}
      data-status={status}
      aria-labelledby={headingId}
    >
      <PanelHeader
        id={headingId}
        eyebrow={
          <>
            Phase {step} <span className={styles.endpoint}>· {endpoint}</span>
          </>
        }
        title={title}
        description={purpose}
        aside={<StatusBadge status={status} />}
      />

      <PanelSection>
        <div className={styles.controls}>
          {blockedReason ? (
            <Callout tone="info" icon="lock">
              {blockedReason}
            </Callout>
          ) : null}
          {controls}
          {status === 'failed' && error ? (
            <Callout tone="error" title="The backend rejected this run" role="alert">
              <p>{error}</p>
            </Callout>
          ) : null}
        </div>
      </PanelSection>

      {/* One polite live region per phase: screen readers hear the outcome
          without the running counter chattering at them. */}
      <p className="sr-only" role="status">
        {status === 'running' ? `${title}: running.` : null}
        {status === 'done'
          ? `${title}: complete in ${duration(elapsedMs ?? 0)}.`
          : null}
        {status === 'failed' ? `${title}: failed. ${error ?? ''}` : null}
      </p>

      {status === 'running' && runningNote ? (
        <PanelSection sunken>
          <div className={styles.insightHead}>
            <p className={styles.readout}>{runningNote}</p>
            <span className={styles.timing}>
              <Icon name="spinner" size={12} />
              {duration(live)}
            </span>
          </div>
        </PanelSection>
      ) : null}

      {status === 'done' && insight ? (
        <PanelSection sunken>
          <div className={styles.insight}>
            <div className={styles.insightHead}>
              <span className={styles.insightTitle}>What came back</span>
              <span className={styles.timing}>{duration(elapsedMs ?? 0)}</span>
            </div>
            {insight}
          </div>
        </PanelSection>
      ) : null}
    </Panel>
  )
}

/** Shared layout for a phase's inputs, an optional full-width preview of what
 *  the current settings would do, and its run button. */
export function PhaseControls({
  inputs,
  preview,
  action,
}: {
  inputs?: ReactNode
  preview?: ReactNode
  action: ReactNode
}) {
  return (
    <>
      {inputs ? <div className={styles.inputs}>{inputs}</div> : null}
      {preview}
      <div className={styles.actions}>{action}</div>
    </>
  )
}

export function Readout({ children }: { children: ReactNode }) {
  return <p className={styles.readout}>{children}</p>
}
