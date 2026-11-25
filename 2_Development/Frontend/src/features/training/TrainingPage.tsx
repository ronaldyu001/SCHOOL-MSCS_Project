import { useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  Button,
  ButtonLink,
  Callout,
  DataTable,
  OptionChips,
  Panel,
  PanelBody,
  PanelHeader,
  PanelSection,
  Stat,
  StatGrid,
} from '@/components/ui'
import { useShell } from '@/app/shell-context'
import { BenchmarkBuildControls } from '@/features/rewards/BenchmarkBuildControls'
import { BuildControls } from '@/features/rewards/BuildControls'
import { RewardCatalogue } from '@/features/rewards/RewardCatalogue'
import { RewardOutcomes } from '@/features/rewards/RewardOutcomes'
import { ModelPanel } from '@/features/harness/ModelPanel'
import { isPreparedBenchmark } from '@/features/pipeline/benchmark'
import { count, percent } from '@/lib/format'
import { downloadExamples, downloadManifest } from './download'
import styles from './TrainingPage.module.css'

/** Make the training data: write rewrites, score them, keep the winners. */
export function TrainingPage() {
  // The shell holds the build, so leaving the tab mid-run no longer throws the
  // result away when it lands.
  const {
    health,
    model,
    pipeline,
    evaluation,
    artifacts,
    rewardBuild: build,
    rewardCatalogue: catalogue,
  } = useShell()
  const [params, setParams] = useSearchParams()
  const benchmark = evaluation.benchmark
  const preparedId =
    benchmark && build.handle && isPreparedBenchmark(build.handle, benchmark)
      ? build.handle.prepared_id
      : null
  const benchmarkMode =
    params.get('mode') === 'benchmark' || (!params.has('mode') && preparedId !== null)
  const busyCompute = Boolean(evaluation.active || artifacts.active)
  const preparing = pipeline.busy || pipeline.runningAll
  const blocked = busyCompute || preparing || health.state === 'offline'

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

      {!benchmarkMode ? <ModelPanel model={model} busy={build.busy} /> : null}

      <RewardCatalogue catalogue={catalogue} />

      <Panel>
        <PanelHeader
          title="Build it"
          description="Each scorer produces a saved dataset of rewrites."
        />
        <PanelSection>
          <OptionChips
            legend="Build settings"
            options={[
              { value: 'benchmark', label: 'Benchmark' },
              { value: 'custom', label: 'Custom' },
            ]}
            selected={benchmarkMode ? 'benchmark' : 'custom'}
            disabled={build.busy}
            onPick={(mode) => setParams({ mode }, { replace: true })}
          />
        </PanelSection>
        {benchmarkMode ? (
          benchmark ? (
            <BenchmarkBuildControls
              benchmark={benchmark}
              build={build}
              preparedId={preparedId}
              counts={preparedId ? build.handle?.partitions.train : undefined}
              disabled={blocked}
            />
          ) : evaluation.error ? (
            <PanelBody>
              <Callout tone="error" title="Couldn’t load the benchmark profile">
                <p>{evaluation.error}</p>
                <Button
                  size="sm"
                  icon="refresh"
                  onClick={() => void evaluation.refresh()}
                >
                  Try again
                </Button>
              </Callout>
            </PanelBody>
          ) : (
            <PanelBody>
              <p>Waiting for the backend benchmark profile.</p>
            </PanelBody>
          )
        ) : (
          <BuildControls build={build} actionLabel="Build" disabled={blocked} />
        )}
        {busyCompute ? (
          <PanelBody>
            <Callout tone="info">
              Wait for the active training or evaluation run before building datasets.
            </Callout>
          </PanelBody>
        ) : null}
        {preparing ? (
          <PanelBody>
            <Callout tone="info">
              Wait for Setup to finish before building datasets.
            </Callout>
          </PanelBody>
        ) : null}
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
          {/index this prepared dataset|prepared dataset not found/i.test(
            state.error,
          ) ? (
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
                columns={['Tried', 'Kept', 'Rate', 'File', 'Training']}
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
                    reward.kept > 0 ? (
                      <ButtonLink
                        key="train"
                        size="sm"
                        variant="ghost"
                        to={`/fine-tuning?dataset=${encodeURIComponent(reward.dataset_id)}`}
                      >
                        Fine-tune
                      </ButtonLink>
                    ) : (
                      '—'
                    ),
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
