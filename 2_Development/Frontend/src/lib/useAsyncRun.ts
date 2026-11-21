import { useCallback, useRef, useState } from 'react'
import { ApiError } from './api'

/** One request's lifecycle, with the timing the harness pages report. */
export type RunState<T> =
  | { status: 'idle' }
  | { status: 'running'; startedAt: number }
  | { status: 'done'; result: T; elapsedMs: number }
  | { status: 'failed'; error: string; elapsedMs: number }

export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return error instanceof Error ? error.message : 'Unexpected error.'
}

export function resultOf<T>(state: RunState<T>): T | null {
  return state.status === 'done' ? state.result : null
}

/**
 * A single tracked request.
 *
 * Every harness call here is long enough to need a visible start, a visible
 * elapsed time and a settled outcome, and short enough that there is only ever
 * one in flight per hook. A generation counter discards the result of a run the
 * user has already superseded, so a slow first call cannot overwrite the
 * second one's answer when it finally returns.
 */
export function useAsyncRun<T>() {
  const [state, setState] = useState<RunState<T>>({ status: 'idle' })
  const generation = useRef(0)

  const run = useCallback(async (call: () => Promise<T>): Promise<T | null> => {
    const id = (generation.current += 1)
    const startedAt = performance.now()
    setState({ status: 'running', startedAt })
    try {
      const result = await call()
      if (generation.current !== id) return null
      setState({
        status: 'done',
        result,
        elapsedMs: Math.round(performance.now() - startedAt),
      })
      return result
    } catch (error) {
      if (generation.current !== id) return null
      setState({
        status: 'failed',
        error: describeError(error),
        elapsedMs: Math.round(performance.now() - startedAt),
      })
      return null
    }
  }, [])

  const reset = useCallback(() => {
    generation.current += 1
    setState({ status: 'idle' })
  }, [])

  return { state, run, reset }
}
