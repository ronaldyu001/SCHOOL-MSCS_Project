import { useCallback, useEffect, useRef, useState } from 'react'
import {
  checkReady,
  getBootStatus,
  type BootStatus,
  type BootStep,
  type ReadinessResponse,
} from '@/lib/api'

const POLL_MS = 1000

/**
 * How long to wait before offering a way past the gate.
 *
 * A cold desktop start legitimately takes tens of minutes — it downloads
 * PyTorch — so a timeout must never be treated as a failure. This only decides
 * when the screen stops assuming the stack is merely slow and admits the user
 * may be running the frontend with no backend at all, which would otherwise
 * lock them out of their own UI indefinitely.
 */
const OFFER_OVERRIDE_AFTER_MS = 45_000

/**
 * How many times to look for a launcher feed before concluding there is none.
 *
 * The launcher starts its status server before it spawns Vite, so a feed that
 * exists is almost always there on the first poll — but the bind is async, so
 * one miss is not proof. After a few, it is, and continuing to poll a path
 * nothing serves just fills the console with proxy errors once a second.
 */
const LAUNCHER_PROBES = 3

export type BootState = {
  /** The app may render. */
  ready: boolean
  /** Steps to show, newest source of truth first. */
  steps: BootStep[]
  /** Set when the launcher gave up; the stack will not come up on its own. */
  error: string | null
  /** True once waiting has gone on long enough to be worth escaping. */
  canOverride: boolean
  /** Startup failed, but a backend from an earlier session is still answering. */
  staleBackend: boolean
  /** The launcher feed, or null when nothing is publishing one. */
  launcher: BootStatus | null
  /** True once a launcher feed has been seen, even if it later goes quiet. */
  hadLauncher: boolean
  readiness: ReadinessResponse | null
  elapsedMs: number
  retry: () => void
  override: () => void
}

/** Readiness, expressed as the same step shape the launcher publishes. */
function apiSteps(readiness: ReadinessResponse | null, reached: boolean): BootStep[] {
  if (readiness) {
    return readiness.dependencies.map((dependency) => ({
      id: dependency.name,
      label: dependency.label,
      status: dependency.status === 'ok' ? 'done' : 'active',
      detail: dependency.detail,
    }))
  }
  return [
    {
      id: 'api',
      label: 'Backend API',
      status: 'active',
      detail: reached
        ? 'Reached the backend; waiting for it to report ready.'
        : 'No answer yet on /api. The container may still be starting.',
    },
  ]
}

/**
 * Fold the latest poll into the steps already on screen.
 *
 * Steps are only ever added or updated, never dropped. The two feeds come and
 * go independently — a readiness poll can fail while the backend restarts, and
 * the launcher's little server can miss a request — and rebuilding the list
 * from whatever answered this second made whole boxes vanish mid-boot. A step
 * that stops reporting keeps its last known state instead.
 */
function mergeSteps(seen: BootStep[], incoming: BootStep[]): BootStep[] {
  const next = [...seen]
  for (const step of incoming) {
    const at = next.findIndex((item) => item.id === step.id)
    if (at === -1) next.push(step)
    else next[at] = step
  }
  return next
}

/**
 * Gate state for the whole app.
 *
 * Two independent sources, because neither alone is enough. The launcher knows
 * about Docker and the containers but has no idea whether the API inside them
 * works; the API knows whether it can reach its memory store but cannot be
 * asked until its container exists. The screen shows both and hands over only
 * when the API itself says it is ready.
 */
export function useBoot(): BootState {
  const [launcher, setLauncher] = useState<BootStatus | null>(null)
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null)
  const [steps, setSteps] = useState<BootStep[]>([])
  const [ready, setReady] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  // Read the clock inside the effect, never during render.
  const startedAt = useRef<number | null>(null)
  const launcherMisses = useRef(0)
  const lastLauncher = useRef<BootStatus | null>(null)
  const reached = useRef(false)
  // State, not a ref: the screen reads this while deciding what to say.
  const [hadLauncher, setHadLauncher] = useState(false)

  useEffect(() => {
    if (ready) return
    startedAt.current ??= Date.now()
    let cancelled = false
    let timer: number | undefined

    const tick = async () => {
      const lookForLauncher = launcherMisses.current < LAUNCHER_PROBES
      const status = lookForLauncher ? await getBootStatus() : null
      if (cancelled) return
      if (lookForLauncher) {
        // Reset on success. Counting misses cumulatively meant three scattered
        // hiccups over a long build retired the feed for good, taking the
        // container steps off the screen with it.
        if (status === null) launcherMisses.current += 1
        else {
          launcherMisses.current = 0
          lastLauncher.current = status
          setHadLauncher(true)
        }
      }
      const boot = launcherMisses.current < LAUNCHER_PROBES ? lastLauncher.current : null
      // Compose publishes ready only after its health check. Until then the
      // API port may be closed or still point to a backend being replaced.
      const launcherStarting = boot !== null && boot.phase !== 'ready' && boot.phase !== 'failed'
      const next = launcherStarting ? null : await checkReady().catch(() => null)
      if (cancelled) return
      setLauncher(boot)
      setReadiness(next)
      setElapsedMs(Date.now() - (startedAt.current ?? Date.now()))
      if (next) reached.current = true
      setSteps((seen) =>
        mergeSteps(seen, [...(boot?.steps ?? []), ...apiSteps(next, reached.current)]),
      )
      // Both have to agree. A warm backend left over from a previous session
      // answers /ready straight away, but the launcher is on its way to
      // recreating that very container with a freshly built image — handing
      // over now would drop the user into a console whose backend is about to
      // restart under it.
      if (next?.ready && (boot === null || boot.phase === 'ready')) {
        setReady(true)
        return
      }
      timer = window.setTimeout(() => void tick(), POLL_MS)
    }

    void tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [ready, nonce])

  const retry = useCallback(() => {
    // An explicit retry looks for the launcher again: the user may have
    // started the desktop session since.
    launcherMisses.current = 0
    lastLauncher.current = null
    startedAt.current = null
    setElapsedMs(0)
    setNonce((value) => value + 1)
  }, [])

  const override = useCallback(() => setReady(true), [])

  const error =
    launcher?.phase === 'failed' ? (launcher.error ?? 'Startup failed.') : null

  // A launcher that failed may still leave an older backend answering. Worth
  // saying plainly rather than spinning: the console would work, but against
  // whatever was running before, not what the launcher was trying to start.
  const staleBackend = error !== null && readiness?.ready === true

  return {
    ready,
    steps,
    error,
    staleBackend,
    canOverride: error !== null || elapsedMs >= OFFER_OVERRIDE_AFTER_MS,
    launcher,
    hadLauncher,
    readiness,
    elapsedMs,
    retry,
    override,
  }
}
