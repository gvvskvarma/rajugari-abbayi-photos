import { Hono } from 'hono'
import type { Env } from './types'
import {
  rateWindowMs, routeRateLimits, routeLimits,
  resolveAllowedOrigin, buildBaseHeaders, responseHeaders, jsonError, SAFE_ERROR_PATTERNS,
} from './lib'

/* ── Route modules ─────────────────────────────────────────────── */
import { live } from './routes/live'
import { admin } from './routes/admin'
import { media } from './routes/media'
import { upload, handleRequestUploadUrl } from './routes/upload'
import { delivery, shareLinks } from './routes/delivery'
import { customer } from './routes/customer'

const app = new Hono<{ Bindings: Env }>()

/* ── CORS preflight ────────────────────────────────────────────── */
app.options('*', (c) => {
  const origin = resolveAllowedOrigin(c.env, c.req.header('Origin'))
  return c.body(null, 204, buildBaseHeaders(origin))
})

/* ── Rate limiting middleware ──────────────────────────────────── */
app.use('/api/*', async (c, next) => {
  const origin = resolveAllowedOrigin(c.env, c.req.header('Origin'))
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'
  const path = new URL(c.req.url).pathname
  const method = c.req.method
  if (method === 'OPTIONS') return next()
  const routeKey = `${ip}:${path}`
  const current = routeRateLimits.get(routeKey)
  const now = Date.now()
  const limit = routeLimits[path] ?? 60
  if (!current || now - current.windowStart > rateWindowMs) {
    routeRateLimits.set(routeKey, { count: 1, windowStart: now })
  } else {
    current.count += 1
    if (current.count > limit) return jsonError('Rate limit exceeded', 429, origin)
  }
  if (routeRateLimits.size > 5000) {
    for (const [key, value] of routeRateLimits.entries()) {
      if (now - value.windowStart > rateWindowMs) routeRateLimits.delete(key)
    }
  }
  await next()
})

/* ── Global error handler ──────────────────────────────────────── */
app.onError((error, c) => {
  const origin = resolveAllowedOrigin(c.env, c.req.header('Origin'))
  const message = error instanceof Error ? error.message : 'Unexpected error'
  const isSafe = SAFE_ERROR_PATTERNS.some((pattern) => pattern.test(message))
  const status = message.toLowerCase().includes('not found') ? 404 : 500
  console.error('[worker error]', message)
  return jsonError(isSafe ? message : 'An internal error occurred', status, origin)
})

/* ── Inline routes (small, public) ─────────────────────────────── */

app.get('/api/v1/health', (c) =>
  c.json(
    {
      ok: true,
      service: 'photography-api',
      timestamp: new Date().toISOString(),
    },
    200,
    responseHeaders(c)
  )
)

app.get('/api/v1/homepage/gallery', async (c) => {
  try {
    const IMAGE_EXT_RE = /\.(jpe?g|png|webp)$/i

    const prefixes: Record<string, string> = {
      landscapes: 'project-rga/landscapes/',
      baby: 'project-rga/potraits/baby/',
      portraits: 'project-rga/potraits/potraits/',
      events: 'project-rga/potraits/events/',
    }

    const entries = await Promise.all(
      Object.entries(prefixes).map(async ([category, prefix]) => {
        const listed = await c.env.R2_MEDIA_BUCKET.list({ prefix })
        const keys = listed.objects
          .map((obj) => obj.key)
          .filter((key) => IMAGE_EXT_RE.test(key))
        return [category, keys] as const
      })
    )

    const categories = Object.fromEntries(entries) as {
      landscapes: string[]
      baby: string[]
      portraits: string[]
      events: string[]
    }

    return c.json({ categories }, 200, {
      ...responseHeaders(c),
      'Cache-Control': 'public, max-age=300',
    })
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to load gallery',
      500
    )
  }
})

/* Public portfolio media (no auth, long cache) */
app.get('/api/v1/public-media/*', async (c) => {
  const path = c.req.path.replace('/api/v1/public-media/', '')
  if (!path || path.includes('..')) {
    return jsonError('Invalid path', 400)
  }

  // Only allow serving from project-rga/optimized/ prefix
  const objectKey = path.startsWith('project-rga/') ? path : `project-rga/${path}`
  if (!objectKey.startsWith('project-rga/optimized/')) {
    return jsonError('Access denied', 403)
  }

  const object = await c.env.R2_MEDIA_BUCKET.get(objectKey)
  if (!object) {
    return jsonError('Not found', 404)
  }

  return new Response(object.body, {
    status: 200,
    headers: {
      ...responseHeaders(c),
      'content-type': object.httpMetadata?.contentType ?? 'image/jpeg',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
})

/* Legacy upload endpoint — same handler as /api/v1/upload/request */
app.post('/api/v1/request-upload-url', handleRequestUploadUrl)

/* ── Mount route modules ───────────────────────────────────────── */
app.route('/api/v1/live-config', live)
app.route('/api/v1/admin', admin)
app.route('/api/v1/media', media)
app.route('/api/v1/upload', upload)
app.route('/api/v1/deliveries', delivery)
app.route('/api/v1/share-links', shareLinks)
app.route('/api/v1', customer)

export default app
