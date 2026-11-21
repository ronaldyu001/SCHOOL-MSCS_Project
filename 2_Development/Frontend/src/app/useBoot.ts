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
  const [reached, setReached] = useState(false)
  const [ready, setReady] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  // Read the clock inside the effect, never during render.
  const startedAt = useRef<number | null>(null)
  const launcherMisses = useRef(0)

  useEffect(() => {
    if (ready) return
    startedAt.current ??= Date.now()
    let cancelled = false
    let timer: number | undefined

    const tick = async () => {
      const lookForLauncher = launcherMisses.current < LAUNCHER_PROBES
      const [boot, next] = await Promise.all([
        lookForLauncher ? getBootStatus() : Promise.resolve(null),
        checkReady().then(
          (value) => value,
          () => null,
        ),
      ])
      if (cancelled) return
      if (lookForLauncher && boot === null) launcherMisses.current += 1
      setLauncher(boot)
      setReadiness(next)
      setElapsedMs(Date.now() - (startedAt.current ?? Date.now()))
      if (next) setReached(true)
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
    startedAt.current = null
    setElapsedMs(0)
    setNonce((value) => value + 1)
  }, [])

  const override = useCallback(() => setReady(true), [])

  const steps = [...(launcher?.steps ?? []), ...apiSteps(readiness, reached)]
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
    readiness,
    elapsedMs,
    retry,
    override,
  }
}
