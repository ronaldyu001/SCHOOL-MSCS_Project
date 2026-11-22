import { useEffect, useMemo } from 'react'
import { Link } from 'react-router'
import {
  Button,
  Callout,
  DataTable,
  Panel,
  PanelBody,
  PanelHeader,
  Stat,
  StatGrid,
} from '@/components/ui'
import { useShell } from '@/app/shell-context'
import { BuildControls } from '@/features/rewards/BuildControls'
import { RewardCatalogue } from '@/features/rewards/RewardCatalogue'
import { RewardOutcomes } from '@/features/rewards/RewardOutcomes'
import { ModelPanel } from '@/features/harness/ModelPanel'
import { count, percent } from '@/lib/format'
import { downloadExamples, downloadManifest } from './download'
import styles from './TrainingPage.module.css'

/** Make the training data: write rewrites, score them, keep the winners. */
export function TrainingPage() {
  // The shell holds the build, so leaving the tab mid-run no longer throws the
  // result away when it lands.
  const { health, model, rewardBuild: build, rewardCatalogue: catalogue } = useShell()

  useEffect(() => {
    document.title = 'Training data · Memory Query Rewriter'
  }, [])

  const definitions = useMemo(
    () => new Map(catalogue.map((reward) => [reward.id, reward])),
    [catalogue],
  )

  const { state, result } = build
  const nextDataset = result?.results.find((reward) => reward.kept > 0)

  const totals = result
    ? result.results.reduce(
        (sum, reward) => ({
          attempted: sum.attempted + reward.attempted,
          kept: sum.kept + reward.kept,
        }),
        { attempted: 0, kept: 0 },
      )
    : null

  return (
    <div className={styles.page}>
      <div>
        <h1>Training data</h1>
        <p className={styles.lede}>
          Write several versions of each question, score them, and keep the one that
          worked best. That gives you a file of good rewrites to train on.
        </p>
        <p className={styles.caveat}>
          <Link to="/artifacts">View saved datasets</Link>
        </p>
      </div>

      {health.state === 'offline' ? (
        <Callout tone="error" title="Can't reach the backend">
          <Button size="sm" icon="refresh" onClick={() => void health.refresh()}>
            Try again
          </Button>
        </Callout>
      ) : null}

      <ModelPanel model={model} busy={build.busy} />

      <RewardCatalogue catalogue={catalogue} />

      <Panel>
        <PanelHeader
          title="Build it"
          description="Tick the scorers you want. Each one produces its own file of rewrites."
        />
        <BuildControls
          build={build}
          actionLabel="Build"
          disabled={health.state === 'offline'}
        />
      </Panel>

      {state.status === 'running' ? (
        <Callout tone="info" icon="refresh">
          {build.saving
            ? 'Saving reward datasets.'
            : build.stopping
              ? 'Stopping after the current operation.'
              : 'Building the reward datasets.'}{' '}
          {Object.entries(build.progress)
            .map(
              ([reward, attempted]) =>
                `${reward.toUpperCase()} ${count(attempted)} attempted`,
            )
            .join(' · ')}
        </Callout>
      ) : null}

      {state.status === 'running' && build.stopError ? (
        <Callout tone="error" title="Couldn’t stop the build">
          {build.stopError}
        </Callout>
      ) : null}

      {state.status === 'done' && result === null ? (
        <Callout tone="info">Build stopped. No dataset was saved.</Callout>
      ) : null}

      {state.status === 'failed' ? (
        <Callout tone="error" title="Couldn't build it" role="alert">
          <p>{state.error}</p>
          {state.error.toLowerCase().includes('index this prepared dataset') ? (
            <p className={styles.hint}>
              <Link to="/setup">Open Setup</Link> to index the training split.
            </p>
          ) : null}
        </Callout>
      ) : null}

      {result && totals ? (
        <>
          <Panel>
            <PanelHeader
              titleAs="h3"
              title="Results"
              aside={
                <Button size="sm" icon="copy" onClick={() => downloadManifest(result)}>
                  Settings file
                </Button>
              }
            />
            <PanelBody>
              {nextDataset ? (
                <Link
                  to={`/fine-tuning?dataset=${encodeURIComponent(nextDataset.dataset_id)}`}
                >
                  Continue to Fine-tuning
                </Link>
              ) : null}
              <StatGrid>
                <Stat
                  label="Rewrites kept"
                  value={count(totals.kept)}
                  hint={`Out of ${count(totals.attempted)} questions tried.`}
                  accent
                />
                <Stat
                  label="Scorers run"
                  value={result.results
                    .map((reward) => reward.reward.toUpperCase())
                    .join(' · ')}
                  text
                />
              </StatGrid>

              <DataTable
                caption="What each scorer kept"
                rowHeader="Scorer"
                columns={['Tried', 'Kept', 'Rate', 'File']}
                rows={result.results.map((reward) => ({
                  key: reward.reward,
                  header: (
                    <span className={styles.rewardName}>
                      <strong>{reward.reward.toUpperCase()}</strong>
                      <span className={styles.rewardTitle}>
                        {definitions.get(reward.reward)?.title ?? ''}
                      </span>
                    </span>
                  ),
                  highlight: reward.kept > 0,
                  cells: [
                    count(reward.attempted),
                    count(reward.kept),
                    percent(reward.kept, reward.attempted),
                    <Button
                      key="file"
                      size="sm"
                      variant="ghost"
                      disabled={reward.examples.length === 0}
                      onClick={() => downloadExamples(reward)}
                    >
                      Download
                    </Button>,
                  ],
                }))}
              />

              {totals.kept === 0 ? (
                <Callout tone="warn" title="Nothing was kept">
                  <p>
                    Every question got thrown out before a winner could be picked. The
                    panels below say why. Usually the rewrites came out too similar, so
                    turning up Variety helps.
                  </p>
                </Callout>
              ) : null}
            </PanelBody>
          </Panel>

          {result.results.map((reward) => (
            <RewardOutcomes
              key={reward.reward}
              result={reward}
              definition={definitions.get(reward.reward)}
            />
          ))}
        </>
      ) : null}
    </div>
  )
}
