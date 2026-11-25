import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildRewardDatasets,
  cancelRewardBuild,
  findRewardBuild,
  watchRewardBuild,
  listRewards,
  REWARD_IDS,
  type PreparedPartition,
  type RewardBuildInput,
  type RewardBuildUpdate,
  type RewardDatasetResponse,
  type RewardDef,
  type RewardId,
} from '@/lib/api'
import { describeError, resultOf, useAsyncRun } from '@/lib/useAsyncRun'
import type { ShellData } from '@/app/shell-context'

export type BuildSettings = {
  rewards: RewardId[]
  maxInputsPerReward: number | null
  keepAllOneTies: boolean
  seed: number
  candidates: number
  temperature: number
  rewriteMaxTokens: number
  topK: number
  tokenBudget: number
  answerMaxTokens: number
  r2PriorTurns: number
  r3MaxTokens: number
}

/** Start with a small pilot. Clearing the input limit uses the full train split. */
export const BUILD_DEFAULTS: BuildSettings = {
  rewards: [...REWARD_IDS],
  maxInputsPerReward: 2,
  keepAllOneTies: false,
  seed: 123,
  candidates: 4,
  temperature: 0.7,
  rewriteMaxTokens: 48,
  topK: 20,
  tokenBudget: 512,
  answerMaxTokens: 64,
  r2PriorTurns: 3,
  r3MaxTokens: 64,
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
export function estimateCalls(settings: BuildSettings, counts?: PreparedPartition) {
  const limit = settings.maxInputsPerReward
  const questionInputs = Math.min(
    limit ?? Infinity,
    counts?.qa_count ?? limit ?? Infinity,
  )
  const turnInputs = Math.min(
    limit ?? Infinity,
    counts?.turn_count ?? limit ?? Infinity,
  )
  const r0 = settings.rewards.includes('r0')
  const r1 = settings.rewards.includes('r1')
  const r2 = settings.rewards.includes('r2')
  const r3 = settings.rewards.includes('r3')
  const candidateSets =
    (r0 || r1 ? questionInputs : 0) + (r2 ? turnInputs : 0) + (r3 ? turnInputs : 0)
  const rewrites = candidateSets * settings.candidates
  // R1 answers once from the full history and once per candidate context; R2
  // scores one baseline continuation plus one per candidate; R3 writes one
  // question per input.
  const reader = r1 ? questionInputs * (settings.candidates + 1) : 0
  const scoring = r2 ? turnInputs * (settings.candidates + 1) : 0
  const synthetic = r3 ? turnInputs : 0
  const fullHistoryReads = r1 ? questionInputs : 0
  const total = rewrites + reader + scoring + synthetic
  return {
    rewrites,
    reader,
    scoring,
    synthetic,
    fullHistoryReads,
    total: Number.isFinite(total) ? total : null,
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
 * The build form, the run, and what it produced.
 *
 * Owned by the shell rather than the training page. A build is minutes of CPU
 * work, and when this lived in the page, leaving the tab discarded the result
 * — the request was never cancelled, so the backend finished the build and the
 * answer arrived to nobody. `reset` is the only thing that clears it.
 */
export function useRewardBuild(
  source: ShellData,
  initial: Partial<BuildSettings> = {},
) {
  const [settings, setSettings] = useState<BuildSettings>({
    ...BUILD_DEFAULTS,
    ...initial,
  })
  const handle =
    source.workspace.handles.find(
      (item) => item.active_training && item.partitions.train.indexed,
    ) ?? null
  const preparedId = handle?.prepared_id
  const build = useAsyncRun<RewardDatasetResponse | null>()
  const [job, setJob] = useState<RewardBuildUpdate | null>(null)
  const [stopRequested, setStopRequested] = useState(false)
  const [stopError, setStopError] = useState<string | null>(null)
  const settingsRef = useRef(settings)
  const tracking = useRef(false)
  const lifecycle = useRef<AbortController | null>(null)
  const { run: runBuild } = build
  // Shared with the search page: a build and the searches you sanity-checked
  // it against should not be able to come from different checkpoints.
  const { modelId, revision } = source.model

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

  useEffect(() => {
    const controller = new AbortController()
    lifecycle.current = controller
    let discovering = false
    const reconnect = async () => {
      if (tracking.current || discovering || controller.signal.aborted) return
      discovering = true
      let attached = false
      try {
        const existing = await findRewardBuild()
        if (!existing || tracking.current || controller.signal.aborted) return
        tracking.current = true
        attached = true
        setStopRequested(false)
        setStopError(null)
        await runBuild(() => watchRewardBuild(existing, setJob, controller.signal))
      } catch {
        // Retry discovery after startup or a connection failure.
      } finally {
        discovering = false
        if (attached && !controller.signal.aborted) tracking.current = false
      }
    }
    void reconnect()
    const timer = setInterval(() => void reconnect(), 5000)
    return () => {
      controller.abort()
      clearInterval(timer)
      tracking.current = false
    }
  }, [runBuild])

  function run(preset?: RewardBuildInput) {
    if (tracking.current || !preparedId) return Promise.resolve(null)
    tracking.current = true
    const current = settingsRef.current
    setJob(null)
    setStopRequested(false)
    setStopError(null)
    return runBuild(async () => {
      const existing = await findRewardBuild()
      if (existing) return watchRewardBuild(existing, setJob, lifecycle.current?.signal)
      return buildRewardDatasets(
        preset ?? {
          preparedId,
          rewards: current.rewards,
          maxInputsPerReward: current.maxInputsPerReward,
          keepAllOneTies: current.rewards.includes('r0') && current.keepAllOneTies,
          seed: current.seed,
          candidates: current.candidates,
          temperature: current.temperature,
          rewriteMaxTokens: current.rewriteMaxTokens,
          topK: current.topK,
          tokenBudget: current.tokenBudget,
          answerMaxTokens: current.answerMaxTokens,
          r2PriorTurns: current.r2PriorTurns,
          r3MaxTokens: current.r3MaxTokens,
          modelId,
          revision,
        },
        setJob,
        lifecycle.current?.signal,
      )
    }).finally(() => {
      tracking.current = false
    })
  }

  const canStop =
    build.state.status === 'running' && job?.status === 'running' && !stopRequested
  const stop = useCallback(async () => {
    if (!canStop || !job) return
    setStopRequested(true)
    setStopError(null)
    try {
      setJob(await cancelRewardBuild(job.id))
    } catch (error) {
      setStopRequested(false)
      setStopError(describeError(error))
    }
  }, [canStop, job])

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

  return {
    settings,
    update,
    toggleReward,
    handle,
    state: build.state,
    result: resultOf(build.state),
    reset: build.reset,
    run,
    stop,
    canStop,
    stopError,
    stopping: stopRequested || job?.status === 'cancelling',
    saving: job?.status === 'saving',
    busy: build.state.status === 'running',
    progress: job?.attempted ?? {},
    estimate: estimateCalls(settings, handle?.partitions.train),
  }
}

export type RewardBuild = ReturnType<typeof useRewardBuild>
