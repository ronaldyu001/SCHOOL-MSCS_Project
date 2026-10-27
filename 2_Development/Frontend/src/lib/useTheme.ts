import { useCallback, useEffect, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'mqr.theme'

function readStored(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // Private browsing and blocked site data both throw here; fall through.
  }
  return 'system'
}

/**
 * Pins the theme by setting `data-theme` on <html>. tokens.css treats the
 * absence of that attribute as "follow the OS", so `system` writes nothing.
 */
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readStored)

  useEffect(() => {
    const root = document.documentElement
    if (preference === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', preference)
    try {
      localStorage.setItem(STORAGE_KEY, preference)
    } catch {
      // A pinned theme that cannot be persisted still applies for this session.
    }
  }, [preference])

  const cycle = useCallback(() => {
    setPreference((current) =>
      current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system',
    )
  }, [])

  return { preference, setPreference, cycle }
}
