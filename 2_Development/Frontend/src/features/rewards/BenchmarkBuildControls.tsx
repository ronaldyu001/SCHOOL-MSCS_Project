import { useState } from 'react'
import { Link } from 'react-router'
import {
  Button,
  Callout,
  CheckGroup,
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
  type RewriteGenerator,
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
  const [generator, setGenerator] = useState<RewriteGenerator>('local')
  const [teacher, setTeacher] = useState<RewriteGenerator>('local')
  const [keepSingleRewrite, setKeepSingleRewrite] = useState(false)
  const seed = benchmark.seeds.includes(selectedSeed)
    ? selectedSeed
    : benchmark.seeds[0]
  const profile = benchmark.build
  const input: RewardBuildInput = {
    preparedId: preparedId ?? '',
    rewriteGenerator: generator,
    r1Teacher: teacher,
    rewards: [...REWARD_IDS],
    modelId: benchmark.model_id,
    revision: benchmark.model_revision,
    seed,
    maxInputsPerReward: pilot ? limit : profile.max_inputs_per_reward,
    keepAllOneTies: profile.keep_all_one_ties,
    keepSingleRewrite,
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
  const ready = !disabled && !build.busy && Boolean(preparedId) && validLimit

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
            label="R1 full-history teacher"
            value={teacher}
            disabled={build.busy}
            hint={
              teacher === 'openai'
                ? 'Sends the entire training conversation to OpenAI for each teacher answer.'
                : undefined
            }
            onChange={(event) => setTeacher(event.target.value === 'openai' ? 'openai' : 'local')}
          >
            <option value="local">Local model</option>
            <option value="openai">GPT-6 Luna (OpenAI API)</option>
          </SelectField>
          <SelectField
            label="Rewrite generator"
            value={generator}
            disabled={build.busy}
            onChange={(event) => setGenerator(event.target.value === 'openai' ? 'openai' : 'local')}
          >
            <option value="local">Local model</option>
            <option value="openai">GPT-6 Luna (OpenAI API)</option>
          </SelectField>
          <SelectField
            label="Build scope"
            value={pilot ? 'pilot' : 'official'}
            disabled={build.busy}
            onChange={(event) => setPilot(event.target.value === 'pilot')}
          >
            <option value="pilot">Capped training build</option>
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
        <CheckGroup
          legend="Sample retention"
          options={[{ value: 'keep', label: 'Keep one rewrite when candidates are duplicates' }]}
          selected={keepSingleRewrite ? ['keep'] : []}
          disabled={build.busy}
          onToggle={() => setKeepSingleRewrite(!keepSingleRewrite)}
        />
      </PanelSection>
      <PanelBody>
        <p>
          Scores R0–R3 using the benchmark pipeline and {benchmark.model_id} at{' '}
          {shortId(benchmark.model_revision)}.
          {generator === 'openai' ? ' GPT-6 Luna sends rewrite inputs to OpenAI.' : ''}
          {generator === 'openai' || teacher === 'openai' || keepSingleRewrite
            ? ' These settings are for experimental comparisons.'
            : ' Official results require a full build for every seed.'}
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
            disabled={!ready}
            onClick={() => void build.run(input)}
          >
            Build benchmark datasets
          </Button>
          {!pilot ? (
            <Button
              disabled={!ready}
              onClick={() => void build.run({ ...input, allBenchmarkSeeds: true })}
            >
              Build all {benchmark.seeds.length * REWARD_IDS.length} datasets
            </Button>
          ) : null}
          {build.busy ? (
            <Button disabled={!build.canStop} onClick={() => void build.stop()}>
              Stop build
            </Button>
          ) : null}
          {preparedId && estimate.total !== null && validLimit ? (
            <p className={styles.estimate}>
              Roughly {count(estimate.total)} model calls per seed.
              {!pilot && ` About ${count(estimate.total * benchmark.seeds.length)} for all seeds.`}
            </p>
          ) : null}
        </div>
      </PanelBody>
    </>
  )
}
