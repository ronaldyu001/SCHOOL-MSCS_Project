import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildRewardDatasets,
  listPrepared,
  listRewards,
  REWARD_IDS,
  type PreparedHandle,
  type RewardDatasetResponse,
  type RewardDef,
  type RewardId,
} from '@/lib/api'
import { resultOf, useAsyncRun } from '@/lib/useAsyncRun'
import { useShell } from '@/app/shell-context'

export type BuildSettings = {
  preparedId: string
  rewards: RewardId[]
  maxInputsPerReward: number
  seed: number
  candidates: number
  temperature: number
  rewriteMaxTokens: number
  topK: number
  tokenBudget: number
  answerMaxTokens: number
  r2PriorTurns: number
  r3MaxTokens: number
  modelId: string
  revision: string
}

/** The route's own defaults, which are sized for a pilot rather than a run. */
export const BUILD_DEFAULTS: BuildSettings = {
  preparedId: '',
  rewards: [...REWARD_IDS],
  maxInputsPerReward: 2,
  seed: 123,
  candidates: 4,
  temperature: 0.7,
  rewriteMaxTokens: 48,
  topK: 20,
  tokenBudget: 512,
  answerMaxTokens: 64,
  r2PriorTurns: 3,
  r3MaxTokens: 64,
  modelId: '',
  revision: '',
}

/**
 * Roughly how many model calls a build will make.
 *
 * Deliberately an upper bound. R0 and R1 share one candidate set when both are
 * selected, and inputs that are skipped before scoring cost nothing, so a real
 * build does fewer calls than this — but a user about to start minutes of CPU
 * work should see the pessimistic figure, not the flattering one.
 *
 * The count alone understates R1, whose teacher answer reads the entire
 * conversation: one call, but on a long LoCoMo conversation it is tens of
 * thousands of tokens of prefill and dominates everything else in the build.
 * `fullHistoryReads` is reported separately for that reason.
 */
export function estimateCalls(settings: BuildSettings) {
  const inputs = settings.maxInputsPerReward
  const shared = settings.rewards.includes('r0') && settings.rewards.includes('r1')
  const candidateSets = shared ? settings.rewards.length - 1 : settings.rewards.length
  const rewrites = candidateSets * inputs * settings.candidates
  // R1 answers once from the full history and once per candidate context; R2
  // scores one baseline continuation plus one per candidate; R3 writes one
  // question per input.
  const reader = settings.rewards.includes('r1')
    ? inputs * (settings.candidates + 1)
    : 0
  const scoring = settings.rewards.includes('r2')
    ? inputs * (settings.candidates + 1)
    : 0
  const synthetic = settings.rewards.includes('r3') ? inputs : 0
  const fullHistoryReads = settings.rewards.includes('r1') ? inputs : 0
  return {
    rewrites,
    reader,
    scoring,
    synthetic,
    fullHistoryReads,
    total: rewrites + reader + scoring + synthetic,
  }
}

/** Reward definitions, served by the backend so the UI cannot offer a missing one. */
export function useRewardCatalogue() {
  const [catalogue, setCatalogue] = useState<RewardDef[]>([])

  useEffect(() => {
    let cancelled = false
    void listRewards()
      .then((next) => {
        if (!cancelled) setCatalogue(next)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  return catalogue
}

/**
 * Prepared datasets the backend still holds, plus the one this session made.
 *
 * A build needs a prepared id and an indexed collection. The pipeline produces
 * both, but a reload loses only the browser's half, so the backend's list is
 * offered too.
 */
export function usePreparedHandles() {
  const { pipeline } = useShell()
  const [handles, setHandles] = useState<PreparedHandle[]>([])
  const prepared = resultOf(pipeline.state.prepare)
  const indexed = resultOf(pipeline.state.index)

  // A failed read leaves the previous list alone: losing the handles because
  // one poll failed would strand a build that is otherwise ready to run.
  const refresh = useCallback(async () => {
    try {
      setHandles(await listPrepared())
    } catch {
      // Reachability is already reported by the health indicator.
    }
  }, [])

  const preparedId = prepared?.prepared_id
  useEffect(() => {
    let cancelled = false
    void listPrepared()
      .then((next) => {
        if (!cancelled) setHandles(next)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [preparedId])

  return useMemo(
    () => ({
      handles,
      refresh,
      sessionPreparedId: prepared?.prepared_id ?? null,
      indexedPartition: indexed?.partition ?? null,
      indexedCollection: indexed?.collection ?? null,
    }),
    [handles, indexed, prepared, refresh],
  )
}

export function useRewardBuild(initial: Partial<BuildSettings> = {}) {
  const [settings, setSettings] = useState<BuildSettings>({
    ...BUILD_DEFAULTS,
    ...initial,
  })
  const prepared = usePreparedHandles()
  const build = useAsyncRun<RewardDatasetResponse>()
  const settingsRef = useRef(settings)

  const update = useCallback(
    <K extends keyof BuildSettings>(key: K, value: BuildSettings[K]) => {
      setSettings((current) => {
        const next = { ...current, [key]: value }
        settingsRef.current = next
        return next
      })
    },
    [],
  )

  // Default to this session's prepared dataset, else the newest the backend has.
  useEffect(() => {
    if (settingsRef.current.preparedId !== '') return
    const fallback = prepared.sessionPreparedId ?? prepared.handles.at(-1)?.prepared_id
    if (fallback) update('preparedId', fallback)
  }, [prepared.handles, prepared.sessionPreparedId, update])

  const run = useCallback(() => {
    const current = settingsRef.current
    return build.run(() =>
      buildRewardDatasets({
        preparedId: current.preparedId.trim(),
        rewards: current.rewards,
        maxInputsPerReward: current.maxInputsPerReward,
        seed: current.seed,
        candidates: current.candidates,
        temperature: current.temperature,
        rewriteMaxTokens: current.rewriteMaxTokens,
        topK: current.topK,
        tokenBudget: current.tokenBudget,
        answerMaxTokens: current.answerMaxTokens,
        r2PriorTurns: current.r2PriorTurns,
        r3MaxTokens: current.r3MaxTokens,
        modelId: current.modelId,
        revision: current.revision,
      }),
    )
  }, [build])

  const toggleReward = useCallback(
    (reward: RewardId) => {
      const current = settingsRef.current.rewards
      const next = current.includes(reward)
        ? current.filter((entry) => entry !== reward)
        : REWARD_IDS.filter((entry) => entry === reward || current.includes(entry))
      // At least one reward, or there is nothing to build.
      update('rewards', next.length > 0 ? next : current)
    },
    [update],
  )

  const handle =
    prepared.handles.find((item) => item.prepared_id === settings.preparedId) ?? null

  return {
    settings,
    update,
    toggleReward,
    prepared,
    handle,
    state: build.state,
    result: resultOf(build.state),
    reset: build.reset,
    run,
    busy: build.state.status === 'running',
    estimate: estimateCalls(settings),
  }
}

export type RewardBuild = ReturnType<typeof useRewardBuild>
