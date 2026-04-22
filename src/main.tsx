import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import App from './App.tsx'
import { initSentry } from './lib/sentry'
import './index.css'

/* Initialize Sentry before render so it can catch errors during bootstrap.
   No-op unless VITE_SENTRY_DSN is set. */
initSentry()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
