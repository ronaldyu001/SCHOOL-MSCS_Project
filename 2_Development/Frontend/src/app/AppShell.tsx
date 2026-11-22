import { useMemo } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { BrandMark, Icon, type IconName } from '@/components/ui'
import { useArtifacts, type Artifacts } from '@/features/artifacts/useArtifacts'
import { useFineTune } from '@/features/fine-tuning/useFineTune'
import { useModel } from '@/features/harness/useModel'
import { usePipeline } from '@/features/pipeline/usePipeline'
import { useRetrieval } from '@/features/retrieval/useRetrieval'
import { useRewardBuild, useRewardCatalogue } from '@/features/rewards/useRewardBuild'
import { bytes, percent } from '@/lib/format'
import { useHealth } from '@/lib/useHealth'
import { useSystemMemory } from '@/lib/useSystemMemory'
import { useTheme } from '@/lib/useTheme'
import { DataBanner } from './DataBanner'
import { readDataReadiness, type DataReadiness } from './data-readiness'
import { HealthIndicator } from './HealthIndicator'
import {
  PRIMARY_ROUTES,
  REQUIREMENT_SOURCE,
  SETUP_ROUTE,
  TOOL_ROUTES,
  type RouteDef,
} from './routes'
import type { ShellContext } from './shell-context'
import { useWorkspace } from './useWorkspace'
import { nextRequirement } from './workflow'
import styles from './AppShell.module.css'

/**
 * Why a tab cannot do its job yet, as one glyph.
 *
 * The navigation is the first thing you touch and the last thing that used to
 * know anything: every tab looked equally ready, so finding out that Search
 * had nothing to search meant clicking it. A tab is never disabled — the page
 * behind it explains itself — but it does say up front which ones are waiting
 * and on what.
 */
type NavMark = { icon: IconName; word: string; busy?: boolean; planned?: boolean }

function markFor(
  route: RouteDef,
  data: DataReadiness,
  artifacts: Artifacts,
): NavMark | null {
  const prerequisite = nextRequirement(route, data, artifacts)
  if (prerequisite) {
    if (prerequisite.state === 'checking') return null
    if (prerequisite.requirement === 'data' && data.state === 'building') {
      return { icon: 'spinner', word: 'waiting for setup', busy: true }
    }
    return {
      icon: 'lock',
      word: `requires ${REQUIREMENT_SOURCE[prerequisite.requirement].label}`,
    }
  }
  if (route.path === SETUP_ROUTE.path && data.progress.running) {
    return { icon: 'spinner', word: 'setting up the data', busy: true }
  }
  if (route.status === 'planned') {
    return { icon: 'dot', word: 'not built yet', planned: true }
  }
  return null
}

export function AppShell() {
  const health = useHealth()
  const pipeline = usePipeline()
  const workspace = useWorkspace()
  const systemMemory = useSystemMemory()
  const { theme, toggle } = useTheme()
  const { pathname } = useLocation()
  const memory = systemMemory.snapshot

  const data = useMemo(
    () => readDataReadiness(workspace, pipeline.state),
    [workspace, pipeline.state],
  )

  // The pages' own run state, held here so that moving between tabs cannot
  // reset it. Each takes what the shell already knows rather than reading the
  // outlet context, which does not exist this far up the tree.
  const model = useModel()
  const source = useMemo(
    () => ({ pipeline, workspace, model }),
    [model, pipeline, workspace],
  )
  const retrieval = useRetrieval(source)
  const rewardBuild = useRewardBuild(source)
  const rewardCatalogue = useRewardCatalogue()
  const artifacts = useArtifacts(rewardBuild.result?.results[0]?.dataset_id, pathname)
  const fineTune = useFineTune(artifacts.refresh)

  const nextTheme = theme === 'dark' ? 'light' : 'dark'

  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <NavLink to={SETUP_ROUTE.path} className={styles.brand}>
            <BrandMark className={styles.mark} />
            <span className={styles.brandText}>
              <span className={styles.brandName}>Memory Query Rewriter</span>
              <span className={styles.brandMeta}>CSCI 6970 · MS Project</span>
            </span>
          </NavLink>

          <nav className={styles.nav} aria-label="Guided workflow">
            {PRIMARY_ROUTES.map((route) => {
              const mark = markFor(route, data, artifacts)
              return (
                <NavLink
                  key={route.path}
                  to={route.path}
                  title={mark ? `${route.summary} — ${mark.word}` : route.summary}
                  className={({ isActive }) =>
                    `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
                  }
                >
                  {route.label}
                  {mark ? (
                    <>
                      {mark.planned ? (
                        <span className={styles.plannedDot} aria-hidden="true" />
                      ) : (
                        <Icon
                          name={mark.icon}
                          size={12}
                          className={`${styles.markIcon} ${mark.busy ? styles.spin : ''}`}
                        />
                      )}
                      <span className="sr-only">({mark.word})</span>
                    </>
                  ) : null}
                </NavLink>
              )
            })}
          </nav>

          <div className={styles.tools}>
            {TOOL_ROUTES.map((route) => (
              <NavLink
                key={route.path}
                to={route.path}
                title={route.summary}
                className={({ isActive }) =>
                  `${styles.toolLink} ${isActive ? styles.navLinkActive : ''}`
                }
              >
                <Icon name={route.icon} size={14} />
                {route.label}
              </NavLink>
            ))}
            <HealthIndicator
              state={health.state}
              checkedAt={health.checkedAt}
              onRefresh={() => void health.refresh()}
            />
            <button
              type="button"
              className={styles.navLink}
              onClick={toggle}
              aria-label={`Switch to the ${nextTheme} theme`}
              title={`${theme === 'dark' ? 'Dark' : 'Light'} theme · switch to ${nextTheme}`}
            >
              <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={15} />
            </button>
          </div>
        </div>
      </header>

      <DataBanner data={data} onSetup={pathname === SETUP_ROUTE.path} />

      <main className={styles.main} id="main">
        <Outlet
          context={
            {
              health,
              pipeline,
              workspace,
              model,
              systemMemory,
              data,
              retrieval,
              rewardBuild,
              rewardCatalogue,
              fineTune,
              artifacts,
            } satisfies ShellContext
          }
        />
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
