import { useCallback, useEffect, useState } from 'react'

export type ThemePreference = 'light' | 'dark'

const STORAGE_KEY = 'mqr.theme'

function prefersDark() {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

function readStored(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Private browsing and blocked site data both throw here; fall through.
  }
  // Nothing chosen yet, so open on whatever the OS is set to and stay there.
  return prefersDark() ? 'dark' : 'light'
}

/**
 * Two themes, one of them always pinned.
 *
 * There used to be a third setting that followed the OS live. It was the
 * default, which meant the control answered "which theme am I on?" with "it
 * depends", and the one-button cycle made you pass through it to get back. The
 * OS now only decides the first visit; after that the choice is the user's and
 * `data-theme` is always written, so the stylesheet never has to guess.
 */
export function useTheme() {
  const [theme, setTheme] = useState<ThemePreference>(readStored)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // A theme that cannot be persisted still applies for this session.
    }
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, setTheme, toggle }
}
