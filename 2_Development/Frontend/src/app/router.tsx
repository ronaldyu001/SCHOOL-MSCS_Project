import { Route, Routes } from 'react-router'
import { PipelinePage } from '@/features/pipeline/PipelinePage'
import { AppShell } from './AppShell'
import { NotFoundPage } from './NotFoundPage'
import { PlannedPage } from './PlannedPage'
import { ROUTES } from './routes'

/**
 * One layout route holding the persistent chrome, with every section nested
 * inside it. Sections come from the ROUTES table, so the navigator and the
 * router cannot disagree about what exists.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        {ROUTES.map((route) =>
          route.status === 'built' ? (
            <Route key={route.path} path={route.path} element={<PipelinePage />} />
          ) : (
            <Route
              key={route.path}
              path={route.path}
              element={<PlannedPage route={route} />}
            />
          ),
        )}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
