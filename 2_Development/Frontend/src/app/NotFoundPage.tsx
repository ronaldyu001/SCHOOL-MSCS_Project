import { Link, useLocation } from 'react-router'
import { Callout } from '@/components/ui'
import { ROUTES } from './routes'

export function NotFoundPage() {
  const { pathname } = useLocation()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <h1>Nothing at this address</h1>
      <Callout tone="warn" title={`No section is routed to ${pathname}`}>
        <p>
          The project has {ROUTES.length} sections:{' '}
          {ROUTES.map((route, index) => (
            <span key={route.path}>
              {index > 0 ? ', ' : ''}
              <Link to={route.path}>{route.label}</Link>
            </span>
          ))}
          .
        </p>
      </Callout>
    </div>
  )
}
