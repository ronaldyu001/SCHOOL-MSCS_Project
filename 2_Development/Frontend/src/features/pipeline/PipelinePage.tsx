import { useEffect } from 'react'
import { Button, Callout } from '@/components/ui'
import { useShell } from '@/app/shell-context'
import { Masthead } from './Masthead'
import { PipelineRail, type RailStep } from './PipelineRail'
import { IndexPhase } from './phases/IndexPhase'
import { LoadPhase } from './phases/LoadPhase'
import { PreparePhase } from './phases/PreparePhase'
import { SplitPhase } from './phases/SplitPhase'
import { statusOf, usePipeline } from './usePipeline'
import styles from './PipelinePage.module.css'

export function PipelinePage() {
  const pipeline = usePipeline()
  const { health } = useShell()
  const { state } = pipeline

  useEffect(() => {
    document.title = 'Dataset pipeline · Memory Query Rewriter'
  }, [])

  const loaded = state.load.status === 'done'
  const splitDone = state.split.status === 'done'
  const preparedDone = state.prepare.status === 'done'

  const steps: RailStep[] = [
    { id: 'phase-load', title: 'Load dataset', status: statusOf(state.load, false) },
    {
      id: 'phase-split',
      title: 'Split by conversation',
      status: statusOf(state.split, !loaded),
    },
    {
      id: 'phase-prepare',
      title: 'Prepare partitions',
      status: statusOf(state.prepare, !splitDone),
    },
    {
      id: 'phase-index',
      title: 'Index memories',
      status: statusOf(state.index, !preparedDone),
    },
  ]

  return (
    <div className={styles.page}>
      <Masthead />

      {health.state === 'offline' ? (
        <Callout tone="error" title="The backend is not responding">
          <p>
            Nothing on this page can run until the API answers at <code>/api</code>.
            Start the stack with <code>docker compose up</code> from{' '}
            <code>2_Development/Deployment</code>, or run the backend directly with{' '}
            <code>uvicorn main:app --reload</code> from{' '}
            <code>2_Development/Backend</code>.
          </p>
          <Button size="sm" icon="refresh" onClick={() => void health.refresh()}>
            Check again
          </Button>
        </Callout>
      ) : null}

      <div className={styles.sectionHead}>
        <div className={styles.sectionIntro}>
          <h2>Dataset and memory pipeline</h2>
          <p className={styles.sectionLede}>
            Four phases, run in order. Each one hands an id to the next, so re-running a
            phase clears everything after it — the ids the backend is holding would no
            longer match.
          </p>
        </div>
        <div className={styles.runControls}>
          <Button
            variant="primary"
            icon="arrow"
            busy={pipeline.runningAll}
            disabled={pipeline.busy || health.state === 'offline'}
            onClick={() => void pipeline.runAll()}
          >
            Run all four phases
          </Button>
          <Button
            variant="ghost"
            icon="refresh"
            disabled={pipeline.busy}
            onClick={pipeline.reset}
          >
            Reset
          </Button>
        </div>
      </div>

      <div className={styles.columns}>
        <PipelineRail steps={steps} />
        <div className={styles.phases}>
          <LoadPhase pipeline={pipeline} />
          <SplitPhase pipeline={pipeline} />
          <PreparePhase pipeline={pipeline} />
          <IndexPhase pipeline={pipeline} />
        </div>
      </div>
    </div>
  )
}
