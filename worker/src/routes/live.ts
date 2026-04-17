import { Hono } from 'hono'
import type { Env } from '../types'
import {
  MAX_SHORT_TEXT, MAX_LONG_TEXT,
  responseHeaders, jsonError,
  supabaseRequest, getUserFromBearer, ensureAdmin,
} from '../lib'

const live = new Hono<{ Bindings: Env }>()

live.get('/', async (c) => {
  try {
    const rows = await supabaseRequest<
      Array<{ title: string; description: string; is_live: boolean; updated_at: string }>
    >(c.env, 'live_config?select=title,description,is_live,updated_at&limit=1')

    const row = rows[0]
    return c.json(
      {
        config: row
          ? { title: row.title, description: row.description, isLive: row.is_live, updatedAt: row.updated_at }
          : null,
      },
      200,
      { ...responseHeaders(c), 'Cache-Control': 'public, max-age=60' }
    )
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load live config', 500)
  }
})

live.patch('/', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    ensureAdmin(user)
    const body = await c.req.json<{ title?: string; description?: string; isLive?: boolean }>()

    const payload: Record<string, string | boolean | null> = {}
    if (typeof body.title === 'string') payload.title = body.title.trim().slice(0, MAX_SHORT_TEXT)
    if (typeof body.description === 'string') payload.description = body.description.trim().slice(0, MAX_LONG_TEXT)
    if (typeof body.isLive === 'boolean') payload.is_live = body.isLive
    payload.updated_at = new Date().toISOString()

    if (Object.keys(payload).length <= 1) return jsonError('No fields provided for update', 400)

    /* Fetch the single config row ID first */
    const existing = await supabaseRequest<Array<{ id: string }>>(c.env, 'live_config?select=id&limit=1')
    const configId = existing[0]?.id
    if (!configId) return jsonError('Live config not initialized', 404)

    const updated = await supabaseRequest<
      Array<{ title: string; description: string; is_live: boolean; updated_at: string }>
    >(c.env, `live_config?id=eq.${encodeURIComponent(configId)}&select=title,description,is_live,updated_at`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    })

    const row = updated[0]
    if (!row) return jsonError('Config not found', 404)
    return c.json(
      { config: { title: row.title, description: row.description, isLive: row.is_live, updatedAt: row.updated_at } },
      200,
      responseHeaders(c)
    )
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to update live config', 400)
  }
})

export { live }
