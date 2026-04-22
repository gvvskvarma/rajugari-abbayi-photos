import * as Sentry from '@sentry/react'

/**
 * Initialize Sentry error tracking.
 *
 * Sentry only activates when VITE_SENTRY_DSN is set in the environment.
 * In development or if DSN is missing, this is a no-op.
 *
 * To enable:
 *   1. Create a project at https://sentry.io
 *   2. Set VITE_SENTRY_DSN in .env.local (local) and in Vercel env vars (prod)
 */
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_RELEASE_SHA || 'dev',
    /* Performance monitoring — sample a small percentage in prod to avoid
       exhausting the free tier (5k errors/mo, 10k perf events/mo). */
    tracesSampleRate: import.meta.env.PROD ? 0.05 : 0,
    /* Session replay on errors only (free tier includes 50 replays/mo).
       Privacy: mask all text and block all media to avoid capturing PII. */
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    /* Filter out noise: chunk load errors (stale deploys — we already handle
       with lazyRetry), browser extensions, and local dev. */
    ignoreErrors: [
      'ChunkLoadError',
      /Loading chunk \d+ failed/,
      /Loading CSS chunk \d+ failed/,
      // Browser extension noise
      /extension\//,
      /^chrome-extension:/,
      /^moz-extension:/,
    ],
    beforeSend(event) {
      // Strip email addresses from breadcrumbs to avoid leaking PII
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((crumb) => {
          if (crumb.message) {
            crumb.message = crumb.message.replace(
              /[\w.+-]+@[\w-]+\.[\w.-]+/g,
              '[email]',
            )
          }
          return crumb
        })
      }
      return event
    },
  })
}

/**
 * Report a handled error to Sentry. Safe to call without Sentry being initialized —
 * will just log to console in that case.
 */
export function reportError(error: unknown, context?: Record<string, unknown>) {
  if (!import.meta.env.VITE_SENTRY_DSN) {
    console.error('[error]', error, context)
    return
  }
  Sentry.withScope((scope) => {
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        scope.setContext(key, value as Record<string, unknown>)
      }
    }
    Sentry.captureException(error)
  })
}
