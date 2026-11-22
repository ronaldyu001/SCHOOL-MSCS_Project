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
  const { settings, update, prepared, handle, estimate, busy } = build
  const counts = handle?.partitions.train
  const needsQuestions =
    settings.rewards.includes('r0') || settings.rewards.includes('r1')
  const missingQuestions =
    needsQuestions && counts !== undefined && counts.qa_count === 0
  const limit = settings.maxInputsPerReward
  const validLimit = limit === null || (Number.isInteger(limit) && limit >= 1)
  const ready =
    settings.preparedId.trim() !== '' &&
    settings.rewards.length > 0 &&
    validLimit &&
    !missingQuestions

  return (
    <>
      <PanelSection>
        <div className={styles.form}>
          <div className={styles.grid}>
            <SelectField
              label="Dataset"
              value={settings.preparedId}
              disabled={busy || prepared.handles.length === 0}
              onChange={(event) => update('preparedId', event.target.value)}
              hint={
                prepared.handles.length === 0
                  ? 'Run the pipeline first to make one.'
                  : 'Uses the indexed training partition.'
              }
            >
              {prepared.handles.length === 0 ? (
                <option value="">None yet</option>
              ) : null}
              {prepared.handles.map((item) => (
                <option key={item.prepared_id} value={item.prepared_id}>
                  {shortId(item.prepared_id)}
                  {item.prepared_id === prepared.sessionPreparedId
                    ? ' (this session)'
                    : ''}
                </option>
              ))}
            </SelectField>

            <TextField
              label="Max inputs per reward"
              type="number"
              min={1}
              placeholder="Full training split"
              hint="Leave blank to build from the full training split."
              value={limit ?? ''}
              disabled={busy}
              onChange={(event) =>
                update('maxInputsPerReward', event.target.value === '' ? null : Number(event.target.value))
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

          {settings.rewards.includes('r0') ? (
            <CheckGroup
              legend="R0 ties"
              options={[{ value: 'keep', label: 'Keep one rewrite when every candidate scores 1' }]}
              selected={settings.keepAllOneTies ? ['keep'] : []}
              disabled={busy}
              onToggle={() => update('keepAllOneTies', !settings.keepAllOneTies)}
            />
          ) : null}

          <Disclosure summary="Options">
            <div className={styles.grid}>
              <TextField
                label="Variety"
                type="number"
                min={0.1}
                max={5}
                step={0.1}
                value={settings.temperature}
                disabled={busy}
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
          {busy ? (
            <Button variant="secondary" disabled={!build.canStop} onClick={() => void build.stop()}>
              Stop build
            </Button>
          ) : null}
          {estimate.total !== null ? (
            <p className={styles.estimate}>Roughly {count(estimate.total)} calls to the model.</p>
          ) : null}
        </div>
      </PanelBody>
    </>
  )
}
