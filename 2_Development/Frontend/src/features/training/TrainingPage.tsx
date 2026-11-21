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
import { RewardOutcomes } from '@/features/rewards/RewardOutcomes'
import { useRewardBuild, useRewardCatalogue } from '@/features/rewards/useRewardBuild'
import { HarnessLine } from '@/features/harness/HarnessLine'
import { count, percent } from '@/lib/format'
import { downloadExamples, downloadManifest } from './download'
import styles from './TrainingPage.module.css'

/** Make the training data: write rewrites, score them, keep the winners. */
export function TrainingPage() {
  const { health } = useShell()
  const catalogue = useRewardCatalogue()
  const build = useRewardBuild()

  useEffect(() => {
    document.title = 'Training data · Memory Query Rewriter'
  }, [])

  const definitions = useMemo(
    () => new Map(catalogue.map((reward) => [reward.id, reward])),
    [catalogue],
  )

  const { state, result } = build
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
          Training a model on that file isn't built yet, so the search page still only
          has the untrained rewriter.
        </p>
      </div>

      {health.state === 'offline' ? (
        <Callout tone="error" title="Can't reach the backend">
          <Button size="sm" icon="refresh" onClick={() => void health.refresh()}>
            Try again
          </Button>
        </Callout>
      ) : null}

      <Panel>
        <PanelHeader title="Build it" />
        <BuildControls
          build={build}
          actionLabel="Build"
          disabled={health.state === 'offline'}
        />
      </Panel>

      {state.status === 'running' ? (
        <Callout tone="info" icon="refresh">
          Running. This takes a while.
        </Callout>
      ) : null}

      {state.status === 'failed' ? (
        <Callout tone="error" title="Couldn't build it" role="alert">
          <p>{state.error}</p>
          <p className={styles.hint}>
            If nothing is indexed yet, run <Link to="/">the pipeline</Link> first.
          </p>
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

      <HarnessLine />
    </div>
  )
}
