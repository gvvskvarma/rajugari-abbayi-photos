import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import App from './App.tsx'
import { initSentry } from './lib/sentry'
import './index.css'

/*
 * Activate deferred stylesheets. Google Fonts in index.html are loaded with
 * `media="print"` so the browser downloads them without blocking initial
 * render. Flip media to "all" so the fonts actually apply once the bundle
 * runs. CSP-safe — no inline event handler.
 */
document.querySelectorAll<HTMLLinkElement>('link[data-deferred-style]').forEach(
  (link) => {
    link.media = 'all'
  },
)

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
