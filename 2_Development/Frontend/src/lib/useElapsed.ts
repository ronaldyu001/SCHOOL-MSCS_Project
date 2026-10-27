import { useEffect, useState } from 'react'

/**
 * Milliseconds since `startedAt`, ticking while it is set.
 *
 * Indexing embeds on CPU behind a process-wide lock and downloads the encoder
 * on its first run, so it can legitimately take minutes. A moving counter is
 * the difference between "working" and "hung".
 *
 * Only the clock reading is held in state; the elapsed figure is subtracted
 * during render. That keeps the render pure and makes a stale reading from an
 * earlier run impossible to show, since it would precede `startedAt`.
 */
export function useElapsed(startedAt: number | null) {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    if (startedAt === null) return
    const id = window.setInterval(() => setNow(performance.now()), 200)
    return () => window.clearInterval(id)
  }, [startedAt])

  if (startedAt === null || now === null || now < startedAt) return 0
  return Math.round(now - startedAt)
}
