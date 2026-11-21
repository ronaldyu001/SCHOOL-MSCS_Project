import { NavLink, Outlet } from 'react-router'
import { BrandMark, Icon } from '@/components/ui'
import { usePipeline } from '@/features/pipeline/usePipeline'
import { bytes, percent } from '@/lib/format'
import { useHealth } from '@/lib/useHealth'
import { useSystemMemory } from '@/lib/useSystemMemory'
import { useTheme, type ThemePreference } from '@/lib/useTheme'
import { HealthIndicator } from './HealthIndicator'
import { ROUTES } from './routes'
import type { ShellContext } from './shell-context'
import styles from './AppShell.module.css'

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
  const pipeline = usePipeline()
  const systemMemory = useSystemMemory()
  const { preference, cycle } = useTheme()
  const memory = systemMemory.snapshot

  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <NavLink to="/" className={styles.brand}>
            <BrandMark className={styles.mark} />
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
        <Outlet context={{ health, pipeline, systemMemory } satisfies ShellContext} />
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span>
            Training memory query rewriters without evidence labels · Ronald Yu · Fall
            2026
            {memory ? (
              <>
                {' · '}
                <span className={styles.hostMemory}>
                  backend host: {bytes(memory.available_bytes)} RAM free of{' '}
                  {bytes(memory.total_bytes)} (
                  {percent(memory.available_bytes, memory.total_bytes)})
                </span>
              </>
            ) : null}
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
