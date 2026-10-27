import { useOutletContext } from 'react-router'
import type { useHealth } from '@/lib/useHealth'

/**
 * State the shell owns and routed pages need. Passed through the router's
 * outlet context rather than a bespoke provider, since the shell is already the
 * only thing wrapping every page.
 */
export type ShellContext = {
  health: ReturnType<typeof useHealth>
}

export function useShell() {
  return useOutletContext<ShellContext>()
}
