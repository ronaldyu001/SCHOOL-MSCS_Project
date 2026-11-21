import type { ReactNode } from 'react'
import { Route, Routes } from 'react-router'
import { PipelinePage } from '@/features/pipeline/PipelinePage'
import { RetrievalPage } from '@/features/retrieval/RetrievalPage'
import { RewardsPage } from '@/features/rewards/RewardsPage'
import { TrainingPage } from '@/features/training/TrainingPage'
import { AppShell } from './AppShell'
import { NotFoundPage } from './NotFoundPage'
import { PlannedPage } from './PlannedPage'
import { ROUTES } from './routes'

/**
 * One layout route holding the persistent chrome, with every section nested
 * inside it. Sections come from the ROUTES table, so the navigator and the
 * router cannot disagree about what exists, and anything still marked planned
 * falls through to the scope page rather than needing a stub component.
 */
const PAGES: Record<string, () => ReactNode> = {
  '/': PipelinePage,
  '/retrieval': RetrievalPage,
  '/rewards': RewardsPage,
  '/training-data': TrainingPage,
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        {ROUTES.map((route) => {
          const Page = route.status === 'built' ? PAGES[route.path] : undefined
          return (
            <Route
              key={route.path}
              path={route.path}
              element={Page ? <Page /> : <PlannedPage route={route} />}
            />
          )
        })}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
