import { NavLink, Outlet } from 'react-router'
import { Icon } from '@/components/ui'
import { useHealth } from '@/lib/useHealth'
import { useTheme, type ThemePreference } from '@/lib/useTheme'
import { HealthIndicator } from './HealthIndicator'
import { ROUTES } from './routes'
import type { ShellContext } from './shell-context'
import styles from './AppShell.module.css'

/** A query leaving for a field of memories. */
function BrandMark() {
  return (
    <svg
      className={styles.mark}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="5.5" cy="12" r="2.25" fill="currentColor" stroke="none" />
      <path d="M11 6.5a7.5 7.5 0 0 1 0 11" />
      <path d="M15.5 3.5a12 12 0 0 1 0 17" opacity="0.55" />
      <path d="M19.75 1.5a16.5 16.5 0 0 1 0 21" opacity="0.28" />
    </svg>
  )
}

const THEME_ICON: Record<ThemePreference, 'monitor' | 'sun' | 'moon'> = {
  system: 'monitor',
  light: 'sun',
  dark: 'moon',
}

const THEME_LABEL: Record<ThemePreference, string> = {
  system: 'Theme: following system',
  light: 'Theme: light',
  dark: 'Theme: dark',
}

export function AppShell() {
  const health = useHealth()
  const { preference, cycle } = useTheme()

  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <NavLink to="/" className={styles.brand}>
            <BrandMark />
            <span className={styles.brandText}>
              <span className={styles.brandName}>Memory Query Rewriter</span>
              <span className={styles.brandMeta}>CSCI 6970 · MS Project</span>
            </span>
          </NavLink>

          <nav className={styles.nav} aria-label="Project sections">
            {ROUTES.map((route) => (
              <NavLink
                key={route.path}
                to={route.path}
                end={route.path === '/'}
                title={route.summary}
                className={({ isActive }) =>
                  `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
                }
              >
                {route.label}
                {route.status === 'planned' ? (
                  <>
                    <span className={styles.plannedDot} aria-hidden="true" />
                    <span className="sr-only">(planned)</span>
                  </>
                ) : null}
              </NavLink>
            ))}
          </nav>

          <div className={styles.tools}>
            <HealthIndicator
              state={health.state}
              checkedAt={health.checkedAt}
              onRefresh={() => void health.refresh()}
            />
            <button
              type="button"
              className={styles.navLink}
              onClick={cycle}
              aria-label={`${THEME_LABEL[preference]}. Activate to change.`}
              title={THEME_LABEL[preference]}
            >
              <Icon name={THEME_ICON[preference]} size={15} />
            </button>
          </div>
        </div>
      </header>

      <main className={styles.main} id="main">
        <Outlet context={{ health } satisfies ShellContext} />
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span>
            Training memory query rewriters without evidence labels · Ronald Yu · Fall
            2026
          </span>
          <ul className={styles.footerLinks}>
            <li>
              <a href="/api/docs" target="_blank" rel="noreferrer">
                API reference
              </a>
            </li>
            <li>
              <a href="/api/health" target="_blank" rel="noreferrer">
                Health
              </a>
            </li>
          </ul>
        </div>
      </footer>
    </div>
  )
}
