import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { ArtifactsPage } from '@/features/artifacts/ArtifactsPage'
import { ResultsPage } from '@/features/evaluation/ResultsPage'
import { FineTuningPage } from '@/features/fine-tuning/FineTuningPage'
import { RetrievalPage } from '@/features/retrieval/RetrievalPage'
import { SetupPage } from '@/features/setup/SetupPage'
import { TrainingPage } from '@/features/training/TrainingPage'
import { AppShell } from './AppShell'
import { NotFoundPage } from './NotFoundPage'
import { PlannedPage } from './PlannedPage'
import { ROUTES } from './routes'
import { WorkflowGate } from './WorkflowGate'

/**
 * One layout route holding the persistent chrome, with every page nested
 * inside it. Pages come from the ROUTES table, so the navigator and the router
 * cannot disagree, and anything still marked planned falls through to the
 * scope page rather than needing a stub component.
 */
const PAGES: Record<string, () => ReactNode> = {
  '/search': RetrievalPage,
  '/training': TrainingPage,
  '/fine-tuning': FineTuningPage,
  '/evaluation': ResultsPage,
  '/artifacts': ArtifactsPage,
  '/setup': SetupPage,
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/setup" replace />} />
        {ROUTES.map((route) => {
          const Page = route.status === 'built' ? PAGES[route.path] : undefined
          const content = Page ? <Page /> : <PlannedPage route={route} />
          return (
            <Route
              key={route.path}
              path={route.path}
              element={
                route.requires?.length ? (
                  <WorkflowGate route={route}>{content}</WorkflowGate>
                ) : (
                  content
                )
              }
            />
          )
        })}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
