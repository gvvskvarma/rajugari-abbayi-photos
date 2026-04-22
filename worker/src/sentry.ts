/**
 * Lightweight Sentry integration for the Cloudflare Worker.
 *
 * Uses Sentry's "Store" HTTP endpoint directly rather than the full @sentry/cloudflare
 * SDK — keeps the worker bundle small and avoids platform compatibility issues.
 *
 * Only activates when SENTRY_DSN is set as a wrangler secret.
 * To enable:
 *   wrangler secret put SENTRY_DSN
 * Paste the DSN from your Sentry project settings.
 */

type SentryEnv = {
  SENTRY_DSN?: string
  APP_ORIGIN?: string
}

/**
 * Parse a Sentry DSN into the bits we need to build an ingest URL.
 * DSN format: https://<publicKey>@<host>/<projectId>
 */
const parseDsn = (dsn: string) => {
  try {
    const url = new URL(dsn)
    const publicKey = url.username
    const projectId = url.pathname.replace(/^\/+/, '')
    if (!publicKey || !projectId) return null
    const ingestUrl = `${url.protocol}//${url.host}/api/${projectId}/store/`
    return { publicKey, projectId, ingestUrl }
  } catch {
    return null
  }
}

/**
 * Report an error to Sentry. Best-effort and non-blocking — failures are
 * swallowed so logging never breaks user requests.
 */
export async function reportWorkerError(
  env: SentryEnv,
  error: unknown,
  context: { requestUrl?: string; requestMethod?: string; [key: string]: unknown } = {},
): Promise<void> {
  const dsn = env.SENTRY_DSN
  if (!dsn) return

  const parsed = parseDsn(dsn)
  if (!parsed) return

  const errorObj = error instanceof Error ? error : new Error(String(error))
  const event = {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level: 'error',
    environment: env.APP_ORIGIN?.includes('localhost') ? 'development' : 'production',
    server_name: 'photography-api',
    exception: {
      values: [
        {
          type: errorObj.name,
          value: errorObj.message,
          stacktrace: errorObj.stack
            ? {
                frames: parseStackTrace(errorObj.stack),
              }
            : undefined,
        },
      ],
    },
    request: context.requestUrl
      ? {
          url: context.requestUrl,
          method: context.requestMethod ?? 'GET',
        }
      : undefined,
    extra: { ...context, requestUrl: undefined, requestMethod: undefined },
  }

  /* Fire-and-forget — don't block the user's request on a logging call. */
  try {
    await fetch(parsed.ingestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': [
          'Sentry sentry_version=7',
          `sentry_key=${parsed.publicKey}`,
          'sentry_client=photography-api/1.0',
        ].join(', '),
      },
      body: JSON.stringify(event),
    })
  } catch {
    // swallow — logging should never break requests
  }
}

/**
 * Minimal stacktrace parser. Converts "at func (file:line:col)" lines into
 * Sentry's frame format. Best-effort — stack formats vary across JS engines.
 */
function parseStackTrace(stack: string): Array<{
  function?: string
  filename?: string
  lineno?: number
  colno?: number
}> {
  return stack
    .split('\n')
    .slice(1)
    .map((line) => {
      const match = line.match(/\s+at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/)
      if (!match) return null
      return {
        function: match[1] || '<anonymous>',
        filename: match[2],
        lineno: parseInt(match[3], 10),
        colno: parseInt(match[4], 10),
      }
    })
    .filter((frame): frame is NonNullable<typeof frame> => frame !== null)
    .reverse() // Sentry wants oldest-first
}
