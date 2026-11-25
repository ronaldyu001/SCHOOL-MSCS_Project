import { useState } from 'react'
import { Link } from 'react-router'
import {
  Button,
  Callout,
  PanelBody,
  PanelSection,
  SelectField,
  TextField,
} from '@/components/ui'
import {
  REWARD_IDS,
  type EvaluationBenchmark,
  type PreparedPartition,
  type RewardBuildInput,
} from '@/lib/api'
import { count, shortId } from '@/lib/format'
import { estimateCalls, type RewardBuild } from './useRewardBuild'
import styles from './BuildControls.module.css'

type Props = {
  benchmark: EvaluationBenchmark
  build: RewardBuild
  preparedId: string | null
  counts?: PreparedPartition
  disabled: boolean
}

export function BenchmarkBuildControls({
  benchmark,
  build,
  preparedId,
  counts,
  disabled,
}: Props) {
  const [selectedSeed, setSeed] = useState(benchmark.seeds[0])
  const [pilot, setPilot] = useState(true)
  const [limit, setLimit] = useState(32)
  const seed = benchmark.seeds.includes(selectedSeed)
    ? selectedSeed
    : benchmark.seeds[0]
  const profile = benchmark.build
  const input: RewardBuildInput = {
    preparedId: preparedId ?? '',
    rewards: [...REWARD_IDS],
    modelId: benchmark.model_id,
    revision: benchmark.model_revision,
    seed,
    maxInputsPerReward: pilot ? limit : profile.max_inputs_per_reward,
    keepAllOneTies: profile.keep_all_one_ties,
    candidates: profile.candidates,
    temperature: profile.temperature,
    rewriteMaxTokens: profile.rewrite_max_tokens,
    topK: profile.top_k,
    tokenBudget: profile.token_budget,
    answerMaxTokens: profile.answer_max_tokens,
    r2PriorTurns: profile.r2_prior_turns,
    r3MaxTokens: profile.r3_max_tokens,
  }
  const estimate = estimateCalls(input, counts)
  const validLimit = !pilot || (Number.isSafeInteger(limit) && limit > 0)

  return (
    <>
      <PanelSection>
        <div className={styles.grid}>
          <SelectField
            label="Benchmark seed"
            value={String(seed)}
            disabled={build.busy}
            onChange={(event) => setSeed(Number(event.target.value))}
          >
            {benchmark.seeds.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Build scope"
            value={pilot ? 'pilot' : 'official'}
            disabled={build.busy}
            onChange={(event) => setPilot(event.target.value === 'pilot')}
          >
            <option value="pilot">Capped validation pilot</option>
            <option value="official">Full benchmark training split</option>
          </SelectField>
          {pilot ? (
            <TextField
              label="Max inputs per reward"
              type="number"
              min={1}
              value={limit || ''}
              disabled={build.busy}
              error={validLimit ? undefined : 'Enter a positive whole number.'}
              onChange={(event) => setLimit(Number(event.target.value))}
            />
          ) : null}
        </div>
      </PanelSection>
      <PanelBody>
        <p>
          Builds R0–R3 with {benchmark.model_id} at {shortId(benchmark.model_revision)}.
          {pilot
            ? ' Use a pilot to check all four rewards before a full build.'
            : ' Repeat the full build for every benchmark seed to qualify for official results.'}
        </p>
        {!preparedId ? (
          <Callout title="Prepare the benchmark split">
            <Link to="/setup">Open Setup</Link> and select “Set up benchmark data”.
          </Callout>
        ) : null}
        <div className={styles.footer}>
          <Button
            variant="primary"
            icon="refresh"
            busy={build.busy}
            disabled={disabled || build.busy || !preparedId || !validLimit}
            onClick={() => void build.run(input)}
          >
            Build benchmark datasets
          </Button>
          {build.busy ? (
            <Button disabled={!build.canStop} onClick={() => void build.stop()}>
              Stop build
            </Button>
          ) : null}
          {estimate.total !== null && validLimit ? (
            <p className={styles.estimate}>
              Roughly {count(estimate.total)} calls to the model.
            </p>
          ) : null}
        </div>
      </PanelBody>
    </>
  )
}
