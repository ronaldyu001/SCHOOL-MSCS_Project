import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Button, Callout, Panel, PanelHeader, SelectField } from '@/components/ui'
import { useShell } from '@/app/shell-context'
import { REWARD_IDS, type RewardId } from '@/lib/api'
import { BuildControls } from './BuildControls'
import { RewardCatalogue } from './RewardCatalogue'
import { RewardOutcomes } from './RewardOutcomes'
import { useRewardBuild, useRewardCatalogue } from './useRewardBuild'
import styles from './RewardsPage.module.css'

/** Try one scorer on a couple of questions and see how it behaves. */
export function RewardsPage() {
  const { health } = useShell()
  const catalogue = useRewardCatalogue()
  const [probe, setProbe] = useState<RewardId>('r1')
  const build = useRewardBuild({ rewards: ['r1'], maxInputsPerReward: 2 })

  useEffect(() => {
    document.title = 'Scoring · Memory Query Rewriter'
  }, [])

  const { update } = build
  useEffect(() => {
    update('rewards', [probe])
  }, [update, probe])

  const definitions = useMemo(
    () => new Map(catalogue.map((reward) => [reward.id, reward])),
    [catalogue],
  )

  const { state, result } = build

  return (
    <div className={styles.page}>
      <div>
        <h1>Scoring</h1>
        <p className={styles.lede}>
          A good rewrite is one that pulls back the right memories. These four scorers
          each judge that differently.
        </p>
      </div>

      {health.state === 'offline' ? (
        <Callout tone="error" title="Can't reach the backend">
          <Button size="sm" icon="refresh" onClick={() => void health.refresh()}>
            Try again
          </Button>
        </Callout>
      ) : null}

      <RewardCatalogue catalogue={catalogue} />

      <Panel>
        <PanelHeader
          title="Try one"
          description="Runs a couple of questions through the full loop so you can see what the scorer accepts and what it throws out."
        />
        <div className={styles.probeHead}>
          <SelectField
            label="Scorer"
            value={probe}
            disabled={build.busy}
            onChange={(event) => setProbe(event.target.value as RewardId)}
          >
            {REWARD_IDS.map((reward) => (
              <option key={reward} value={reward}>
                {reward.toUpperCase()} — {definitions.get(reward)?.title ?? reward}
              </option>
            ))}
          </SelectField>
        </div>
        <BuildControls
          build={build}
          chooseRewards={false}
          actionLabel={`Try ${probe.toUpperCase()}`}
          disabled={health.state === 'offline'}
        />
      </Panel>

      {state.status === 'running' ? (
        <Callout tone="info" icon="refresh">
          Running. This takes a few minutes.
        </Callout>
      ) : null}

      {state.status === 'failed' ? (
        <Callout tone="error" title="Couldn't run it" role="alert">
          <p>{state.error}</p>
          <p className={styles.hint}>
            If nothing is indexed yet, run <Link to="/">the pipeline</Link> first.
          </p>
        </Callout>
      ) : null}

      {result?.results.map((reward) => (
        <RewardOutcomes
          key={reward.reward}
          result={reward}
          definition={definitions.get(reward.reward)}
        />
      ))}
    </div>
  )
}
