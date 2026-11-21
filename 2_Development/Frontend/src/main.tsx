import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { BootGate } from './app/BootGate'
import { AppRoutes } from './app/router'
import './styles/tokens.css'
import './styles/base.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element in index.html.')

createRoot(container).render(
  <StrictMode>
    <BootGate>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </BootGate>
  </StrictMode>,
)
