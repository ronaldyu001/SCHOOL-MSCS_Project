import {
  Button,
  Callout,
  CheckGroup,
  Disclosure,
  PanelBody,
  PanelSection,
  SelectField,
  TextField,
  type CheckOption,
} from '@/components/ui'
import { REWARD_IDS, type RewardId } from '@/lib/api'
import { count, shortId } from '@/lib/format'
import type { RewardBuild } from './useRewardBuild'
import styles from './BuildControls.module.css'

type BuildControlsProps = {
  build: RewardBuild
  chooseRewards?: boolean
  actionLabel: string
  disabled?: boolean
}

const REWARD_OPTIONS: CheckOption<RewardId>[] = REWARD_IDS.map((reward) => ({
  value: reward,
  label: reward.toUpperCase(),
}))

/** Settings for a run. Two matter; the rest have sensible defaults. */
export function BuildControls({
  build,
  chooseRewards = true,
  actionLabel,
  disabled,
}: BuildControlsProps) {
  const { settings, update, handle, estimate, busy } = build
  const counts = handle?.partitions.train
  const needsQuestions =
    settings.rewards.includes('r0') || settings.rewards.includes('r1')
  const missingQuestions =
    needsQuestions && counts !== undefined && counts.qa_count === 0
  const limit = settings.maxInputsPerReward
  const validLimit = limit === null || (Number.isInteger(limit) && limit >= 1)
  const usesLuna = settings.rewriteGenerator === 'openai'
  const maxTemperature = usesLuna ? 2 : 5
  const validTemperature = settings.temperature > 0 && settings.temperature <= maxTemperature
  const ready =
    handle !== null &&
    settings.rewards.length > 0 &&
    validLimit &&
    validTemperature &&
    !missingQuestions

  return (
    <>
      <PanelSection>
        <div className={styles.form}>
          <div className={styles.grid}>
            <TextField
              label="Active training dataset"
              value={handle ? shortId(handle.prepared_id) : 'None'}
              readOnly
              hint={handle ? undefined : 'Index a training partition in Setup.'}
            />

            <TextField
              label="Max inputs per reward"
              type="number"
              min={1}
              placeholder="Full training split"
              hint="Leave blank to build from the full training split."
              value={limit ?? ''}
              disabled={busy}
              onChange={(event) =>
                update(
                  'maxInputsPerReward',
                  event.target.value === '' ? null : Number(event.target.value),
                )
              }
            />

            <TextField
              label="Rewrites each"
              type="number"
              min={2}
              max={16}
              value={settings.candidates}
              disabled={busy}
              onChange={(event) => update('candidates', Number(event.target.value))}
            />
            <SelectField
              label="Rewrite generator"
              value={settings.rewriteGenerator}
              disabled={busy}
              hint={
                usesLuna ? 'Sends rewrite inputs to OpenAI. Requires a backend API key.' : undefined
              }
              onChange={(event) =>
                update('rewriteGenerator', event.target.value === 'openai' ? 'openai' : 'local')
              }
            >
              <option value="local">Local model</option>
              <option value="openai">GPT-6 Luna (OpenAI API)</option>
            </SelectField>
            {settings.rewards.includes('r1') ? (
              <SelectField
                label="R1 full-history teacher"
                value={settings.r1Teacher}
                disabled={busy}
                hint={
                  settings.r1Teacher === 'openai'
                    ? 'Sends the entire training conversation to OpenAI for each teacher answer.'
                    : undefined
                }
                onChange={(event) =>
                  update('r1Teacher', event.target.value === 'openai' ? 'openai' : 'local')
                }
              >
                <option value="local">Local model</option>
                <option value="openai">GPT-6 Luna (OpenAI API)</option>
              </SelectField>
            ) : null}
          </div>

          {chooseRewards ? (
            <CheckGroup
              legend="Scorers"
              options={REWARD_OPTIONS}
              selected={settings.rewards}
              disabled={busy}
              onToggle={build.toggleReward}
            />
          ) : null}

          <CheckGroup
            legend="Sample retention"
            options={[
              { value: 'keepTiedRewrite', label: 'Keep one rewrite when all scores tie' },
              { value: 'keepSingleRewrite', label: 'Keep one rewrite when candidates are duplicates' },
            ]}
            selected={[
              ...(settings.keepTiedRewrite ? ['keepTiedRewrite' as const] : []),
              ...(settings.keepSingleRewrite ? ['keepSingleRewrite' as const] : []),
            ]}
            disabled={busy}
            onToggle={(key) => update(key, !settings[key])}
          />

          <Disclosure summary="Options">
            <div className={styles.grid}>
              <TextField
                label="Variety"
                type="number"
                min={0.1}
                max={maxTemperature}
                step={0.1}
                value={settings.temperature}
                disabled={busy}
                error={
                  validTemperature ? undefined : `Enter a value above 0 and up to ${maxTemperature}.`
                }
                onChange={(event) => update('temperature', Number(event.target.value))}
              />
              <TextField
                label="Seed"
                type="number"
                value={settings.seed}
                disabled={busy}
                onChange={(event) => update('seed', Number(event.target.value))}
              />
              <TextField
                label="Memories to pull"
                type="number"
                min={1}
                max={50}
                value={settings.topK}
                disabled={busy}
                onChange={(event) => update('topK', Number(event.target.value))}
              />
              <TextField
                label="Context size"
                type="number"
                min={1}
                max={8192}
                value={settings.tokenBudget}
                disabled={busy}
                onChange={(event) => update('tokenBudget', Number(event.target.value))}
              />
              <TextField
                label="Rewrite length"
                type="number"
                min={1}
                max={256}
                value={settings.rewriteMaxTokens}
                disabled={busy}
                onChange={(event) =>
                  update('rewriteMaxTokens', Number(event.target.value))
                }
              />
              <TextField
                label="Answer length"
                type="number"
                min={1}
                max={256}
                value={settings.answerMaxTokens}
                disabled={busy}
                onChange={(event) =>
                  update('answerMaxTokens', Number(event.target.value))
                }
              />
            </div>
          </Disclosure>
        </div>
      </PanelSection>

      <PanelBody>
        {missingQuestions ? (
          <Callout tone="warn" title="This partition has no questions">
            <p>
              R0 and R1 need questions to work with. Widen the category filter in the
              pipeline, or use R2 and R3 instead.
            </p>
          </Callout>
        ) : null}

        {estimate.fullHistoryReads > 0 ? (
          <Callout tone="warn" title="R1 is slow">
            <p>
              R1 reads the whole conversation for every question, which takes minutes
              each on CPU. Drop it if you want a quick look.
            </p>
          </Callout>
        ) : null}

        <div className={styles.footer}>
          <Button
            variant="primary"
            icon="refresh"
            busy={busy}
            disabled={busy || disabled || !ready}
            onClick={() => void build.run()}
          >
            {actionLabel}
          </Button>
          {ready && estimate.total !== null ? (
            <p className={styles.estimate}>
              Roughly {count(estimate.total)} calls to the model.
            </p>
          ) : null}
        </div>
      </PanelBody>
    </>
  )
}
