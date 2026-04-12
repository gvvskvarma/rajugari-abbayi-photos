import { Hono } from 'hono'
import type { Context } from 'hono'

import type {
  Env, Mode, MediaVariant, AdminActivityKind, AdminActivityRow, ShareLinkScope,
} from './types'
import {
  adminActivityKinds, rateWindowMs, maxUploadBytes, uploadUrlExpirySeconds,
  routeRateLimits, routeLimits, MAX_SHORT_TEXT, MAX_LONG_TEXT,
  resolveAllowedOrigin, buildBaseHeaders, responseHeaders, jsonError, SAFE_ERROR_PATTERNS,
  supabaseRequest, getUserFromBearer, ensureAdmin, ensureDeliveryAccess,
  ensureAdminAndOwnedDelivery, ensureAdminOwnedAsset,
  createUploadToken, verifyUploadToken, createPreviewToken, verifyPreviewToken,
  createDownloadToken, verifyDownloadToken,
  buildR2SignedUrl, resolvePreviewAccessContext, buildPreviewUrlForAsset, buildPreviewUrlBatch,
  getDeliveryAssetRules, getShareLinkContext,
  insertAdminActivity, serializeAdminActivity, normalizeActivityMetadata,
  logDownloadEvent, deleteStoredAssets, streamZipResponse,
  parseNullableText, sanitizeFileName, parseProjectStatus, getDisplayFileName,
  sha256Hex, sanitizeArchiveEntryName,
} from './lib'

const app = new Hono<{ Bindings: Env }>()

app.options('*', (c) => {
  const origin = resolveAllowedOrigin(c.env, c.req.header('Origin'))
  return c.body(null, 204, buildBaseHeaders(origin))
})

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

app.onError((error, c) => {
  const origin = resolveAllowedOrigin(c.env, c.req.header('Origin'))
  const message = error instanceof Error ? error.message : 'Unexpected error'
  const isSafe = SAFE_ERROR_PATTERNS.some((pattern) => pattern.test(message))
  const status = message.toLowerCase().includes('not found') ? 404 : 500
  console.error('[worker error]', message)
  return jsonError(isSafe ? message : 'An internal error occurred', status, origin)
})

/* ── Routes ──────────────────────────────────────────────────────── */

/* Type-only imports used within route handler bodies below */
type _A = AdminActivityRow; type _B = AdminActivityKind; type _C = MediaVariant; type _D = Mode; type _E = ShareLinkScope


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

app.get('/api/v1/me', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    const profile = await supabaseRequest<Array<{ display_name: string | null }>>(
      c.env,
      `profiles?id=eq.${encodeURIComponent(user.id)}&select=display_name&limit=1`
    )
    return c.json(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: profile[0]?.display_name ?? null,
      },
      200,
      responseHeaders(c)
    )
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load profile', 401)
  }
})

app.get('/api/v1/admin/activity', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    ensureAdmin(user)

    const limitRaw = Number.parseInt(c.req.query('limit') ?? '', 10)
    const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : 24
    const kind = c.req.query('kind')?.trim()
    const clientId = c.req.query('clientId')?.trim()
    const projectId = c.req.query('projectId')?.trim()
    const assetId = c.req.query('assetId')?.trim()

    const filters = [`owner_user_id=eq.${encodeURIComponent(user.id)}`]
    if (kind && adminActivityKinds.has(kind as AdminActivityKind)) {
      filters.push(`kind=eq.${encodeURIComponent(kind)}`)
    }
    if (clientId) filters.push(`client_id=eq.${encodeURIComponent(clientId)}`)
    if (projectId) filters.push(`project_id=eq.${encodeURIComponent(projectId)}`)
    if (assetId) filters.push(`asset_id=eq.${encodeURIComponent(assetId)}`)

    const rows = await supabaseRequest<AdminActivityRow[]>(
      c.env,
      `admin_activity_events?${filters.join('&')}&select=id,owner_user_id,actor_profile_id,kind,title,detail,client_id,project_id,asset_id,metadata,created_at&order=created_at.desc&limit=${limit}`
    )

    return c.json({ activities: rows.map(serializeAdminActivity) }, 200, responseHeaders(c))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load admin activity', 403)
  }
})

app.post('/api/v1/admin/activity', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    ensureAdmin(user)
    const body = await c.req.json<{
      kind?: string
      title?: string
      detail?: string
      clientId?: string | null
      projectId?: string | null
      assetId?: string | null
      metadata?: unknown
    }>()

    const kind = typeof body.kind === 'string' && adminActivityKinds.has(body.kind as AdminActivityKind)
      ? (body.kind as AdminActivityKind)
      : undefined
    if (!kind) {
      return jsonError('kind is required and must be a valid activity type', 400)
    }

    const title = body.title?.trim()
    const detail = body.detail?.trim()
    if (!title || !detail) {
      return jsonError('title and detail are required', 400)
    }

    const activity = await insertAdminActivity(c.env, {
      ownerUserId: user.id,
      actorProfileId: user.id,
      kind,
      title,
      detail,
      clientId: body.clientId ?? null,
      projectId: body.projectId ?? null,
      assetId: body.assetId ?? null,
      metadata: body.metadata,
    })

    if (!activity) return jsonError('Failed to store admin activity', 500)
    return c.json({ activity: serializeAdminActivity(activity) }, 201, responseHeaders(c))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to store admin activity', 400)
  }
})

app.get('/api/v1/admin/clients', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    ensureAdmin(user)

    const clients = await supabaseRequest<
      Array<{ id: string; full_name: string; email: string; phone: string | null; notes: string | null }>
    >(c.env, `clients?owner_user_id=eq.${encodeURIComponent(user.id)}&select=id,full_name,email,phone,notes&order=created_at.desc`)

    return c.json({ clients }, 200, responseHeaders(c))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load clients', 403)
  }
})

app.post('/api/v1/admin/clients', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    ensureAdmin(user)
    const body = await c.req.json<{ fullName?: string; email?: string; phone?: string; notes?: string }>()

    const fullName = parseNullableText(body.fullName)
    const email = parseNullableText(body.email)?.toLowerCase()
    if (!fullName || !email) {
      return jsonError('fullName and email are required', 400)
    }

    const inserted = await supabaseRequest<
      Array<{ id: string; full_name: string; email: string; phone: string | null; notes: string | null }>
    >(
      c.env,
      'clients?select=id,full_name,email,phone,notes',
      {
        method: 'POST',
        body: JSON.stringify({
          owner_user_id: user.id,
          full_name: fullName,
          email,
          phone: parseNullableText(body.phone),
          notes: parseNullableText(body.notes, MAX_LONG_TEXT),
        }),
      }
    )

    return c.json({ client: inserted[0] }, 201, responseHeaders(c))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to create client', 400)
  }
})

app.patch('/api/v1/admin/clients/:clientId', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    ensureAdmin(user)
    const clientId = c.req.param('clientId')
    const body = await c.req.json<{ fullName?: string; email?: string; phone?: string; notes?: string }>()
    if (!clientId) return jsonError('clientId is required', 400)

    const payload: Record<string, string | null> = {}
    if (typeof body.fullName === 'string') payload.full_name = parseNullableText(body.fullName)
    if (typeof body.email === 'string') payload.email = parseNullableText(body.email)?.toLowerCase() ?? null
    if (typeof body.phone === 'string') payload.phone = parseNullableText(body.phone)
    if (typeof body.notes === 'string') payload.notes = parseNullableText(body.notes, MAX_LONG_TEXT)
    if (Object.keys(payload).length === 0) return jsonError('No fields provided for update', 400)

    const updated = await supabaseRequest<
      Array<{ id: string; full_name: string; email: string; phone: string | null; notes: string | null }>
    >(
      c.env,
      `clients?id=eq.${encodeURIComponent(clientId)}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id,full_name,email,phone,notes`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    )

    if (!updated[0]) return jsonError('Client not found', 404)
    return c.json({ client: updated[0] }, 200, responseHeaders(c))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to update client', 400)
  }
})

app.delete('/api/v1/admin/clients/:clientId', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    ensureAdmin(user)
    const clientId = c.req.param('clientId')
    if (!clientId) return jsonError('clientId is required', 400)

    // Collect R2 keys before deleting DB records
    const projects = await supabaseRequest<Array<{ id: string }>>(
      c.env,
      `projects?client_id=eq.${encodeURIComponent(clientId)}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id`
    )
    const projectIds = projects.map((project) => project.id)
    let r2Keys: string[] = []
    if (projectIds.length > 0) {
      const projectFilter = projectIds.map((id) => `project_id.eq.${encodeURIComponent(id)}`).join(',')
      const assets = await supabaseRequest<Array<{ r2_object_key: string }>>(
        c.env,
        `assets?or=(${projectFilter})&select=r2_object_key`
      )
      r2Keys = assets.map((asset) => asset.r2_object_key)
    }

    // Delete DB first — if this fails, R2 files remain (safe); reverse would orphan DB records
    await supabaseRequest(
      c.env,
      `clients?id=eq.${encodeURIComponent(clientId)}&owner_user_id=eq.${encodeURIComponent(user.id)}`,
      {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      }
    )

    // Clean up R2 after DB success — orphaned files are harmless, orphaned DB records are not
    if (r2Keys.length > 0) {
      await deleteStoredAssets(c.env, r2Keys)
    }

    return c.json({ ok: true }, 200, responseHeaders(c))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to delete client', 400)
  }
})

app.get('/api/v1/admin/projects', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    ensureAdmin(user)
    const clientId = c.req.query('clientId')

    const filters = [`owner_user_id=eq.${encodeURIComponent(user.id)}`]
    if (clientId) filters.push(`client_id=eq.${encodeURIComponent(clientId)}`)

    const projects = await supabaseRequest<
      Array<{
        id: string
        client_id: string
        name: string
        description: string | null
        shoot_date: string | null
        location: string | null
        status: 'draft' | 'active' | 'completed' | 'archived'
      }>
    >(c.env, `projects?${filters.join('&')}&select=id,client_id,name,description,shoot_date,location,status&order=created_at.desc`)

    return c.json({ projects }, 200, responseHeaders(c))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load projects', 403)
  }
})

app.post('/api/v1/admin/projects', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    ensureAdmin(user)
    const body = await c.req.json<{
      clientId?: string
      name?: string
      description?: string
      shootDate?: string
      location?: string
      status?: string
    }>()

    const clientId = parseNullableText(body.clientId)
    const name = parseNullableText(body.name)
    if (!clientId || !name) return jsonError('clientId and name are required', 400)

    const inserted = await supabaseRequest<
      Array<{
        id: string
        client_id: string
        name: string
        description: string | null
        shoot_date: string | null
        location: string | null
        status: 'draft' | 'active' | 'completed' | 'archived'
      }>
    >(
      c.env,
      'projects?select=id,client_id,name,description,shoot_date,location,status',
      {
        method: 'POST',
        body: JSON.stringify({
          owner_user_id: user.id,
          client_id: clientId,
          name,
          description: parseNullableText(body.description, MAX_LONG_TEXT),
          shoot_date: parseNullableText(body.shootDate),
          location: parseNullableText(body.location),
          status: parseProjectStatus(body.status) ?? 'draft',
        }),
      }
    )

    return c.json({ project: inserted[0] }, 201, responseHeaders(c))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to create project', 400)
  }
})

app.patch('/api/v1/admin/projects/:projectId', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    ensureAdmin(user)
    const projectId = c.req.param('projectId')
    const body = await c.req.json<{
      name?: string
      description?: string
      shootDate?: string
      location?: string
      status?: string
    }>()
    if (!projectId) return jsonError('projectId is required', 400)

    const payload: Record<string, string | null> = {}
    if (typeof body.name === 'string') payload.name = parseNullableText(body.name)
    if (typeof body.description === 'string') payload.description = parseNullableText(body.description, MAX_LONG_TEXT)
    if (typeof body.shootDate === 'string') payload.shoot_date = parseNullableText(body.shootDate)
    if (typeof body.location === 'string') payload.location = parseNullableText(body.location)
    if (body.status !== undefined) {
      const parsedStatus = parseProjectStatus(body.status)
      if (!parsedStatus) return jsonError('Invalid status', 400)
      payload.status = parsedStatus
    }
    if (Object.keys(payload).length === 0) return jsonError('No fields provided for update', 400)

    const updated = await supabaseRequest<
      Array<{
        id: string
        client_id: string
        name: string
        description: string | null
        shoot_date: string | null
        location: string | null
        status: 'draft' | 'active' | 'completed' | 'archived'
      }>
    >(
      c.env,
      `projects?id=eq.${encodeURIComponent(projectId)}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id,client_id,name,description,shoot_date,location,status`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    )

    if (!updated[0]) return jsonError('Project not found', 404)
    return c.json({ project: updated[0] }, 200, responseHeaders(c))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to update project', 400)
  }
})

app.delete('/api/v1/admin/projects/:projectId', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    ensureAdmin(user)
    const projectId = c.req.param('projectId')
    if (!projectId) return jsonError('projectId is required', 400)

    const assets = await supabaseRequest<Array<{ r2_object_key: string }>>(
      c.env,
      `assets?project_id=eq.${encodeURIComponent(projectId)}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=r2_object_key`
    )
    const r2Keys = assets.map((asset) => asset.r2_object_key)

    // Delete DB first, then R2 — orphaned files are harmless, orphaned DB records are not
    await supabaseRequest(
      c.env,
      `projects?id=eq.${encodeURIComponent(projectId)}&owner_user_id=eq.${encodeURIComponent(user.id)}`,
      {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      }
    )

    if (r2Keys.length > 0) {
      await deleteStoredAssets(c.env, r2Keys)
    }

    return c.json({ ok: true }, 200, responseHeaders(c))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to delete project', 400)
  }
})

const handleRequestUploadUrl = async (c: Context<{ Bindings: Env }>) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    const body = await c.req.json<{
      deliveryId: string
      fileName: string
      contentType: string
      fileSize: number
    }>()

    if (!body.deliveryId || !body.fileName || !body.contentType || !body.fileSize) {
      return jsonError('deliveryId, fileName, contentType, fileSize are required', 400)
    }

    const allowedMimePatterns = ['image/', 'video/', 'application/pdf']
    if (!allowedMimePatterns.some((prefix) => body.contentType.startsWith(prefix))) {
      return jsonError('Only image, video, and PDF files are allowed', 400)
    }

    if (body.fileSize <= 0 || body.fileSize > maxUploadBytes) {
      return jsonError('File size must be between 1 byte and 5GB', 413)
    }

    await ensureAdminAndOwnedDelivery(c.env, user, body.deliveryId)

    const deliveries = await supabaseRequest<Array<{ project_id: string }>>(
      c.env,
      `deliveries?id=eq.${encodeURIComponent(body.deliveryId)}&select=project_id&limit=1`
    )
    const projectId = deliveries[0]?.project_id
    if (!projectId) return jsonError('Delivery project not found', 404)

    const safeFileName = sanitizeFileName(body.fileName)
    const objectKey = `deliveries/${body.deliveryId}/raw/${Date.now()}-${safeFileName}`
    const uploadToken = crypto.randomUUID().replace(/-/g, '')
    const expiresAt = new Date(Date.now() + uploadUrlExpirySeconds * 1000).toISOString()
    const uploadUrl = await buildR2SignedUrl(c.env, 'PUT', objectKey, uploadUrlExpirySeconds, 'view')
    const signedUploadToken = await createUploadToken(c.env.SUPABASE_SERVICE_ROLE_KEY, {
      v: 1,
      uploadId: uploadToken,
      ownerUserId: user.id,
      deliveryId: body.deliveryId,
      projectId,
      objectKey,
      originalFilename: safeFileName,
      mimeType: body.contentType,
      expectedBytes: Math.max(1, Math.trunc(body.fileSize)),
      issuedAt: new Date().toISOString(),
      expiresAt,
    })

    return c.json(
      {
        objectKey,
        uploadToken: signedUploadToken,
        uploadUrl,
        expiresInSeconds: uploadUrlExpirySeconds,
        maxFileBytes: maxUploadBytes,
      },
      200,
      responseHeaders(c)
    )
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Upload request failed', 400)
  }
}

app.post('/api/v1/request-upload-url', handleRequestUploadUrl)
app.post('/api/v1/upload/request', handleRequestUploadUrl)

app.post('/api/v1/upload/complete', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    const body = await c.req.json<{
      deliveryId: string
      objectKey: string
      uploadToken: string
      fileName: string
      mimeType: string
      bytes: number
    }>()

    if (
      !body.deliveryId ||
      !body.objectKey ||
      !body.uploadToken ||
      !body.fileName ||
      !body.mimeType ||
      !body.bytes
    ) {
      return jsonError('deliveryId, objectKey, uploadToken, fileName, mimeType, bytes are required', 400)
    }

    await ensureAdminAndOwnedDelivery(c.env, user, body.deliveryId)

    const session = await verifyUploadToken(c.env.SUPABASE_SERVICE_ROLE_KEY, body.uploadToken)
    if (session.ownerUserId !== user.id) return jsonError('Upload token does not match the current admin', 403)
    if (session.deliveryId !== body.deliveryId) return jsonError('Upload token does not match this delivery', 403)
    if (session.objectKey !== body.objectKey) return jsonError('Upload token does not match this file', 403)
    if (session.originalFilename !== sanitizeFileName(body.fileName)) {
      return jsonError('Upload token does not match this filename', 403)
    }
    if (session.mimeType !== body.mimeType) return jsonError('Upload token does not match this file type', 403)
    if (Math.abs(session.expectedBytes - body.bytes) > Math.max(1024, session.expectedBytes * 0.02)) {
      return jsonError('Uploaded byte count does not match requested file size', 400)
    }

    const deliveries = await supabaseRequest<Array<{ project_id: string }>>(
      c.env,
      `deliveries?id=eq.${encodeURIComponent(body.deliveryId)}&select=project_id&limit=1`
    )
    const projectId = deliveries[0]?.project_id
    if (!projectId) return jsonError('Delivery project not found', 404)
    if (projectId !== session.projectId) return jsonError('Upload token does not match this project', 403)

    const kind = body.mimeType.startsWith('video/') ? 'video' : 'photo'

    const existingAssets = await supabaseRequest<Array<{ id: string }>>(
      c.env,
      `assets?r2_object_key=eq.${encodeURIComponent(body.objectKey)}&select=id&limit=1`
    )
    const existingAssetId = existingAssets[0]?.id
    if (existingAssetId) {
      return c.json(
        {
          ok: true,
          assetId: existingAssetId,
          uploadSessionId: session.uploadId,
        },
        200,
        responseHeaders(c)
      )
    }

    const insertedAssets = await supabaseRequest<Array<{ id: string }>>(
      c.env,
      'assets?select=id',
      {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          owner_user_id: user.id,
          project_id: projectId,
          delivery_id: body.deliveryId,
          kind,
          filename: body.fileName,
          mime_type: body.mimeType,
          bytes: Math.max(1, body.bytes),
          r2_object_key: body.objectKey,
        }),
      },
      true
    )
    const assetId = insertedAssets[0]?.id
    if (!assetId) return jsonError('Asset insert failed', 500)

    await supabaseRequest(
      c.env,
      'delivery_assets',
      {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          delivery_id: body.deliveryId,
          asset_id: assetId,
        }),
      },
      true
    )

    return c.json(
      {
        ok: true,
        assetId,
        uploadSessionId: session.uploadId,
      },
      200,
      responseHeaders(c)
    )
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Upload finalize failed', 400)
  }
})

app.delete('/api/v1/admin/assets/:assetId', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    const assetId = c.req.param('assetId')
    if (!assetId) return jsonError('assetId is required', 400)

    const asset = await ensureAdminOwnedAsset(c.env, user, assetId)
    if (!asset.r2_object_key.startsWith('pending/')) {
      await c.env.R2_MEDIA_BUCKET.delete(asset.r2_object_key)
    }

    await supabaseRequest(
      c.env,
      `assets?id=eq.${encodeURIComponent(assetId)}&owner_user_id=eq.${encodeURIComponent(user.id)}`,
      {
        method: 'DELETE',
      },
      true
    )

    return c.json({ ok: true, assetId }, 200, responseHeaders(c))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Asset delete failed', 400)
  }
})

app.post('/api/v1/media/signed-url', async (c) => {
  try {
    const authHeader = c.req.header('authorization')
    const body = await c.req.json<{ assetId: string; mode?: Mode; shareToken?: string }>()
    const mode: Mode = body.mode === 'download' ? 'download' : 'view'

    if (!body.assetId) return jsonError('assetId is required', 400)

    const assets = await supabaseRequest<
      Array<{ id: string; delivery_id: string | null; r2_object_key: string; mime_type: string; filename: string }>
    >(
      c.env,
      `assets?id=eq.${encodeURIComponent(body.assetId)}&select=id,delivery_id,r2_object_key,mime_type,filename&limit=1`
    )

    const asset = assets[0]
    if (!asset) return jsonError('Asset not found', 404)
    if (asset.r2_object_key.startsWith('pending/')) {
      return jsonError('This file was never uploaded to storage. Re-upload it from Admin Upload.', 410)
    }

    const deliveryAssetRows = await supabaseRequest<
      Array<{ delivery_id: string }>
    >(
      c.env,
      `delivery_assets?asset_id=eq.${encodeURIComponent(body.assetId)}&select=delivery_id&limit=1`
    )
    const deliveryAsset = deliveryAssetRows[0]
    const deliveryId = asset.delivery_id ?? deliveryAsset?.delivery_id
    if (!deliveryId || !deliveryAsset) return jsonError('Asset delivery mapping missing', 403)

    if (body.shareToken) {
      const context = await getShareLinkContext(c.env, body.shareToken)
      if (!context) return jsonError('Invalid share token', 403)
      if (new Date(context.link.expires_at).getTime() <= Date.now()) return jsonError('Share link expired', 403)
      if (context.link.delivery_id !== deliveryId) return jsonError('Asset not in shared delivery', 403)
      if (context.link.scope_type === 'selected' && !context.selectedAssetIds.has(asset.id)) {
        return jsonError('Asset not in shared selection', 403)
      }
      if (mode === 'download' && !context.link.allow_download) return jsonError('Download not allowed', 403)

      if (mode === 'download') {
        const requesterIp = c.req.header('CF-Connecting-IP')
        const ipHash = requesterIp ? await sha256Hex(requesterIp) : null
        await logDownloadEvent(c.env, {
          deliveryId,
          assetId: asset.id,
          requesterProfileId: null,
          ipHash,
          userAgent: c.req.header('User-Agent') ?? null,
        })
      }

      const objectHead = await c.env.R2_MEDIA_BUCKET.head(asset.r2_object_key)
      if (!objectHead) {
        return jsonError('File missing in storage for this asset. Re-upload required.', 404)
      }

      if (mode === 'download') {
        const origin = new URL(c.req.url).origin
        const downloadToken = await createDownloadToken(c.env.SUPABASE_SERVICE_ROLE_KEY, {
          v: 1,
          assetId: asset.id,
          deliveryId,
          r2ObjectKey: asset.r2_object_key,
          filename: asset.filename,
          mimeType: asset.mime_type,
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        })
        const signedUrl = `${origin}/api/v1/media/download?token=${encodeURIComponent(downloadToken)}`
        return c.json({ signedUrl, expiresInSeconds: 300, mode }, 200, responseHeaders(c))
      }

      const signedUrl = await buildR2SignedUrl(c.env, 'GET', asset.r2_object_key, 300, mode)
      return c.json({ signedUrl, expiresInSeconds: 300, mode }, 200, responseHeaders(c))
    }

    const user = await getUserFromBearer(c.env, authHeader)
    await ensureDeliveryAccess(c.env, user, deliveryId, mode)

    if (mode === 'download') {
      const requesterIp = c.req.header('CF-Connecting-IP')
      const ipHash = requesterIp ? await sha256Hex(requesterIp) : null
      await logDownloadEvent(c.env, {
        deliveryId,
        assetId: asset.id,
        requesterProfileId: user.id,
        ipHash,
        userAgent: c.req.header('User-Agent') ?? null,
      })
    }

    const objectHead = await c.env.R2_MEDIA_BUCKET.head(asset.r2_object_key)
    if (!objectHead) {
      return jsonError('File missing in storage for this asset. Re-upload required.', 404)
    }

    if (mode === 'download') {
      const origin = new URL(c.req.url).origin
      const downloadToken = await createDownloadToken(c.env.SUPABASE_SERVICE_ROLE_KEY, {
        v: 1,
        assetId: asset.id,
        deliveryId,
        r2ObjectKey: asset.r2_object_key,
        filename: asset.filename,
        mimeType: asset.mime_type,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      })
      const signedUrl = `${origin}/api/v1/media/download?token=${encodeURIComponent(downloadToken)}`
      return c.json({ signedUrl, expiresInSeconds: 300, mode }, 200, responseHeaders(c))
    }

    const signedUrl = await buildR2SignedUrl(c.env, 'GET', asset.r2_object_key, 300, mode)
    return c.json({ signedUrl, expiresInSeconds: 300, mode }, 200, responseHeaders(c))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Signed URL request failed', 400)
  }
})

app.post('/api/v1/media/preview-url', async (c) => {
  try {
    const authHeader = c.req.header('authorization')
    const body = await c.req.json<{ assetId: string; variant?: MediaVariant; shareToken?: string }>()

    if (!body.assetId) return jsonError('assetId is required', 400)

    const access = await resolvePreviewAccessContext(c.env, authHeader, body.shareToken)
    const variant: MediaVariant = body.variant === 'thumb' ? 'thumb' : 'preview'
    const payload = await buildPreviewUrlForAsset(c.env, new URL(c.req.url).origin, access, body.assetId, variant)

    return c.json({ url: payload.url, expiresInSeconds: 300 }, 200, responseHeaders(c))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Preview URL request failed', 400)
  }
})

app.post('/api/v1/media/preview-url-batch', async (c) => {
  try {
    const authHeader = c.req.header('authorization')
    const body = await c.req.json<{ assetIds: string[]; variant?: MediaVariant; shareToken?: string }>()

    const assetIds = [...new Set((body.assetIds ?? []).map((assetId) => assetId.trim()).filter(Boolean))]
    if (assetIds.length === 0) return jsonError('assetIds is required', 400)

    const access = await resolvePreviewAccessContext(c.env, authHeader, body.shareToken)
    const variant: MediaVariant = body.variant === 'thumb' ? 'thumb' : 'preview'
    const origin = new URL(c.req.url).origin

    /* Batch: 2 queries total instead of 2N */
    const urls = await buildPreviewUrlBatch(c.env, origin, access, assetIds, variant)

    return c.json({ urls, expiresInSeconds: 300 }, 200, responseHeaders(c))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Preview URL batch request failed', 400)
  }
})

app.get('/api/v1/media/preview', async (c) => {
  try {
    const token = c.req.query('token')
    if (!token) return jsonError('token is required', 400)

    const payload = await verifyPreviewToken(c.env.SUPABASE_SERVICE_ROLE_KEY, token)
    const assets = await supabaseRequest<
      Array<{ id: string; delivery_id: string | null; r2_object_key: string; mime_type: string; filename: string }>
    >(
      c.env,
      `assets?id=eq.${encodeURIComponent(payload.assetId)}&select=id,delivery_id,r2_object_key,mime_type,filename&limit=1`
    )

    const asset = assets[0]
    if (!asset) return jsonError('Asset not found', 404)
    if (asset.delivery_id !== payload.deliveryId) {
      return jsonError('Preview token does not match this asset', 403)
    }

    const object = await c.env.R2_MEDIA_BUCKET.get(asset.r2_object_key)
    if (!object) {
      return jsonError('File missing in storage for this asset. Re-upload required.', 404)
    }

    return new Response(object.body, {
      status: 200,
      headers: {
        ...responseHeaders(c),
        'content-type': object.httpMetadata?.contentType ?? asset.mime_type,
        'cache-control': 'private, max-age=300',
        'content-disposition': 'inline',
      },
    })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Preview failed', 400)
  }
})

app.get('/api/v1/media/download', async (c) => {
  try {
    const token = c.req.query('token')
    if (!token) return jsonError('token is required', 400)

    const payload = await verifyDownloadToken(c.env.SUPABASE_SERVICE_ROLE_KEY, token)

    const object = await c.env.R2_MEDIA_BUCKET.get(payload.r2ObjectKey)
    if (!object) {
      return jsonError('File missing in storage. Re-upload required.', 404)
    }

    const safeFilename = (payload.filename || 'download').replace(/[^\w.\-() ]/g, '_')

    return new Response(object.body, {
      status: 200,
      headers: {
        ...responseHeaders(c),
        'content-type': object.httpMetadata?.contentType ?? payload.mimeType ?? 'application/octet-stream',
        'content-disposition': `attachment; filename="${safeFilename}"`,
        'cache-control': 'private, no-cache',
      },
    })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Download failed', 400)
  }
})

app.get('/api/v1/media/thumb', async (c) => {
  try {
    const token = c.req.query('token')
    if (!token) return jsonError('token is required', 400)

    const payload = await verifyPreviewToken(c.env.SUPABASE_SERVICE_ROLE_KEY, token)
    const assets = await supabaseRequest<
      Array<{ id: string; delivery_id: string | null; r2_object_key: string; mime_type: string; filename: string }>
    >(
      c.env,
      `assets?id=eq.${encodeURIComponent(payload.assetId)}&select=id,delivery_id,r2_object_key,mime_type,filename&limit=1`
    )

    const asset = assets[0]
    if (!asset) return jsonError('Asset not found', 404)
    if (asset.delivery_id !== payload.deliveryId) {
      return jsonError('Preview token does not match this asset', 403)
    }
    if (!asset.mime_type.startsWith('image/')) {
      return jsonError('Thumbnails are only available for image files', 400)
    }

    const signedUrl = await buildR2SignedUrl(c.env, 'GET', asset.r2_object_key, 300, 'view')

    try {
      const resized = await fetch(signedUrl, {
        cf: {
          image: {
            width: 640,
            height: 480,
            fit: 'cover',
            quality: 72,
            format: 'webp',
            metadata: 'none',
            anim: false,
          },
        },
      } as RequestInit)

      if (!resized.ok) {
        throw new Error(`Thumbnail generation failed (${resized.status})`)
      }

      return new Response(resized.body, {
        status: 200,
        headers: {
          ...responseHeaders(c),
          'content-type': resized.headers.get('content-type') ?? 'image/webp',
          'cache-control': 'private, max-age=3600',
          'content-disposition': 'inline',
        },
      })
    } catch {
      const object = await c.env.R2_MEDIA_BUCKET.get(asset.r2_object_key)
      if (!object) {
        return jsonError('File missing in storage for this asset. Re-upload required.', 404)
      }

      return new Response(object.body, {
        status: 200,
        headers: {
          ...responseHeaders(c),
          'content-type': object.httpMetadata?.contentType ?? asset.mime_type,
          'cache-control': 'private, max-age=3600',
          'content-disposition': 'inline',
        },
      })
    }
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Thumbnail failed', 400)
  }
})

app.post('/api/v1/admin/downloads', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    ensureAdmin(user)
    const body = await c.req.json<{ assetIds?: string[]; filename?: string }>()
    const assetIds = [...new Set((body.assetIds ?? []).filter((assetId) => typeof assetId === 'string' && assetId.trim()))]
    if (assetIds.length === 0) return jsonError('assetIds are required', 400)

    const assets = await supabaseRequest<Array<{ id: string; filename: string; r2_object_key: string }>>(
      c.env,
      `assets?owner_user_id=eq.${encodeURIComponent(user.id)}&select=id,filename,r2_object_key,created_at&order=created_at.asc`
    )

    const selectedAssets = assets.filter((asset) => assetIds.includes(asset.id))
    if (selectedAssets.length === 0) return jsonError('No matching assets found', 404)

    const archiveName = `${sanitizeArchiveEntryName(body.filename ?? 'selected-files')}.zip`
    return streamZipResponse(c, selectedAssets, archiveName)
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Download failed', 400)
  }
})

app.post('/api/v1/admin/projects/:projectId/download', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    ensureAdmin(user)
    const projectId = c.req.param('projectId')
    if (!projectId) return jsonError('projectId is required', 400)

    const projects = await supabaseRequest<Array<{ id: string; name: string }>>(
      c.env,
      `projects?id=eq.${encodeURIComponent(projectId)}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id,name&limit=1`
    )
    const project = projects[0]
    if (!project) return jsonError('Project not found', 404)

    const assets = await supabaseRequest<Array<{ id: string; filename: string; r2_object_key: string }>>(
      c.env,
      `assets?project_id=eq.${encodeURIComponent(projectId)}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id,filename,r2_object_key,created_at&order=created_at.asc`
    )
    if (assets.length === 0) return jsonError('No files found for this project', 404)

    return streamZipResponse(c, assets, `${sanitizeArchiveEntryName(project.name)}.zip`)
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Project download failed', 400)
  }
})

app.post('/api/v1/deliveries/:deliveryId/download', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    const deliveryId = c.req.param('deliveryId')
    if (!deliveryId) return jsonError('deliveryId is required', 400)

    await ensureDeliveryAccess(c.env, user, deliveryId, 'download')

    const body = await c.req.json<{ assetIds?: string[] }>()
    const requestedIds = body.assetIds && body.assetIds.length > 0
      ? [...new Set(body.assetIds.filter((id) => typeof id === 'string' && id.trim()))]
      : null

    const assetRules = await getDeliveryAssetRules(c.env, deliveryId)
    const downloadableAssetIds = [...assetRules.values()]
      .filter((rule) => rule.canDownload)
      .map((rule) => rule.assetId)

    if (downloadableAssetIds.length === 0) return jsonError('No downloadable assets', 404)

    const targetIds = requestedIds
      ? requestedIds.filter((id) => downloadableAssetIds.includes(id))
      : downloadableAssetIds

    if (targetIds.length === 0) return jsonError('No matching downloadable assets', 404)

    const assetFilter = targetIds.map((id) => `id.eq.${id}`).join(',')
    const assets = await supabaseRequest<
      Array<{ id: string; filename: string; r2_object_key: string }>
    >(
      c.env,
      `assets?or=(${assetFilter})&select=id,filename,r2_object_key&order=created_at.asc`
    )
    const uploadedAssets = assets.filter((asset) => !asset.r2_object_key.startsWith('pending/'))
    if (uploadedAssets.length === 0) return jsonError('No files available for download', 404)

    const requesterIp = c.req.header('CF-Connecting-IP')
    const ipHash = requesterIp ? await sha256Hex(requesterIp) : null
    for (const asset of uploadedAssets) {
      await logDownloadEvent(c.env, {
        deliveryId,
        assetId: asset.id,
        requesterProfileId: user.id,
        ipHash,
        userAgent: c.req.header('User-Agent') ?? null,
      })
    }

    const archiveName = `photos-${deliveryId.slice(0, 8)}.zip`
    return streamZipResponse(c, uploadedAssets, archiveName)
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Download failed', 400)
  }
})

app.get('/api/v1/deliveries/:deliveryId/gallery', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    const deliveryId = c.req.param('deliveryId')
    if (!deliveryId) return jsonError('deliveryId is required', 400)

    const accessMode = await ensureDeliveryAccess(c.env, user, deliveryId, 'view')
    const assetRules = await getDeliveryAssetRules(c.env, deliveryId)
    const visibleAssetIds = [...assetRules.values()]
      .filter((rule) => rule.canView)
      .map((rule) => rule.assetId)

    if (visibleAssetIds.length === 0) {
      return c.json({ deliveryId, accessMode, assets: [] }, 200, responseHeaders(c))
    }

    const assetFilter = visibleAssetIds.map((id) => `id.eq.${id}`).join(',')
    const assets = await supabaseRequest<
      Array<{ id: string; filename: string; mime_type: string; bytes: number; r2_object_key: string }>
    >(
      c.env,
      `assets?or=(${assetFilter})&select=id,filename,mime_type,bytes,r2_object_key&order=created_at.desc`
    )
    const uploadedAssets = assets.filter((asset) => !asset.r2_object_key.startsWith('pending/'))

        return c.json(
          {
            deliveryId,
            accessMode,
            assets: uploadedAssets.map((asset) => ({
              ...asset,
              canView: true,
              canDownload: accessMode !== 'viewer' && (assetRules.get(asset.id)?.canDownload ?? false),
            })),
          },
          200,
      responseHeaders(c)
    )
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load private gallery', 400)
  }
})

app.get('/api/v1/share-links/:token/gallery', async (c) => {
  try {
    const token = c.req.param('token')
    if (!token) return jsonError('token is required', 400)

    const context = await getShareLinkContext(c.env, token)
    if (!context) return jsonError('Invalid share token', 403)
    if (new Date(context.link.expires_at).getTime() <= Date.now()) return jsonError('Share link expired', 403)

    const visibleAssetIds =
      context.link.scope_type === 'selected'
        ? [...context.selectedAssetIds]
        : [...(await getDeliveryAssetRules(c.env, context.link.delivery_id)).values()]
            .filter((rule) => rule.canView)
            .map((rule) => rule.assetId)

    const assets = visibleAssetIds.length
      ? await supabaseRequest<
          Array<{
            id: string
            delivery_id: string | null
            filename: string
            mime_type: string
            bytes: number
            r2_object_key: string
            created_at: string
          }>
        >(
          c.env,
          `assets?or=(${visibleAssetIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',')})&select=id,delivery_id,filename,mime_type,bytes,r2_object_key,created_at&order=created_at.desc`
        )
      : []

    return c.json(
      {
        deliveryId: context.link.delivery_id,
        scopeType: context.link.scope_type,
        allowDownload: context.link.allow_download,
        expiresAt: context.link.expires_at,
        assets: assets.filter(
          (asset) =>
            asset.delivery_id === context.link.delivery_id && !asset.r2_object_key.startsWith('pending/')
        ),
      },
      200,
      responseHeaders(c)
    )
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Share gallery load failed', 400)
  }
})

app.post('/api/v1/share-links', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    const body = await c.req.json<{
      deliveryId: string
      expiresInDays?: number
      scope?: ShareLinkScope
      assetIds?: string[]
    }>()
    if (!body.deliveryId) return jsonError('deliveryId is required', 400)

    const accessMode = await ensureDeliveryAccess(c.env, user, body.deliveryId, 'view')
    if (accessMode === 'viewer') {
      return jsonError('Viewer accounts cannot create share links', 403)
    }

    const assetIds = [...new Set((body.assetIds ?? []).map((assetId) => assetId.trim()).filter(Boolean))]
    const scope: ShareLinkScope = body.scope === 'selected' || (body.scope !== 'all' && assetIds.length > 0) ? 'selected' : 'all'
    if (scope === 'selected' && assetIds.length === 0) {
      return jsonError('Select at least one file for a selected-files link', 400)
    }
    if (scope === 'all' && assetIds.length > 0) {
      return jsonError('assetIds can only be used with selected-files links', 400)
    }

    let selectedAssets: Array<{ id: string; delivery_id: string | null; r2_object_key: string }> = []
    if (scope === 'selected') {
      selectedAssets = await supabaseRequest<Array<{ id: string; delivery_id: string | null; r2_object_key: string }>>(
        c.env,
        `assets?or=(${assetIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',')})&select=id,delivery_id,r2_object_key`
      )

      if (selectedAssets.length !== assetIds.length) {
        return jsonError('One or more selected files are unavailable', 404)
      }

      const selectedAssetMap = new Map(selectedAssets.map((asset) => [asset.id, asset]))
      const invalidAssetId = assetIds.find((assetId) => {
        const asset = selectedAssetMap.get(assetId)
        return !asset || asset.delivery_id !== body.deliveryId || asset.r2_object_key.startsWith('pending/')
      })

      if (invalidAssetId) {
        return jsonError('Selected files must belong to this folder and be fully uploaded', 400)
      }
    }

    const days = Math.min(30, Math.max(1, body.expiresInDays ?? 7))
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    const token = crypto.randomUUID().replace(/-/g, '')

    const inserted = await supabaseRequest<Array<{ id: string; token: string; scope_type: ShareLinkScope }>>(
      c.env,
      'share_links?select=id,token,scope_type',
      {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          token,
          owner_profile_id: user.id,
          delivery_id: body.deliveryId,
          scope_type: scope,
          access_mode: 'viewer',
          allow_download: false,
          expires_at: expiresAt,
        }),
      },
      true
    )

    const shareLink = inserted[0]
    if (!shareLink) return jsonError('Share link creation failed', 500)

    if (scope === 'selected') {
      try {
        await supabaseRequest(
          c.env,
          'share_link_assets',
          {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify(
              assetIds.map((assetId) => ({
                share_link_id: shareLink.id,
                asset_id: assetId,
              }))
            ),
          },
          true
        )
      } catch (error) {
        await supabaseRequest(
          c.env,
          `share_links?id=eq.${encodeURIComponent(shareLink.id)}`,
          { method: 'DELETE' },
          true
        )
        throw error
      }
    }

    return c.json(
      {
        token: shareLink.token ?? token,
        url: `${c.env.APP_ORIGIN}/#share/${shareLink.token ?? token}`,
        scopeType: shareLink.scope_type ?? scope,
        expiresAt,
      },
      200,
      responseHeaders(c)
    )
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Share link creation failed', 400)
  }
})

app.get('/api/v1/my-pictures', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))

    const recipients = await supabaseRequest<
      Array<{ delivery_id: string; access_mode: 'owner' | 'viewer'; expires_at: string | null }>
    >(
      c.env,
      `delivery_recipients?email=eq.${encodeURIComponent(
        user.email
      )}&select=delivery_id,access_mode,expires_at`
    )

    const activeRecipients = recipients.filter(
      (row) => !row.expires_at || new Date(row.expires_at).getTime() > Date.now()
    )

    if (activeRecipients.length === 0) {
      return c.json({ deliveries: [] }, 200, responseHeaders(c))
    }

    const deliveryIds = [...new Set(activeRecipients.map((row) => row.delivery_id))]
    const deliveryRows = await supabaseRequest<
      Array<{ id: string; project_id: string | null }>
    >(
      c.env,
      `deliveries?id=in.(${deliveryIds.map((id) => encodeURIComponent(id)).join(',')})&select=id,project_id`
    )
    const projectIds = [...new Set(deliveryRows.map((row) => row.project_id).filter((value): value is string => Boolean(value)))]
    const projects = projectIds.length
      ? await supabaseRequest<Array<{ id: string; client_id: string | null; name: string; status: string }>>(
          c.env,
          `projects?id=in.(${projectIds.map((id) => encodeURIComponent(id)).join(',')})&select=id,client_id,name,status`
        )
      : []
    const clientIds = [...new Set(projects.map((project) => project.client_id).filter((value): value is string => Boolean(value)))]
    const clients = clientIds.length
      ? await supabaseRequest<Array<{ id: string; full_name: string }>>(
          c.env,
          `clients?id=in.(${clientIds.map((id) => encodeURIComponent(id)).join(',')})&select=id,full_name`
        )
      : []

    const deliveryToProject = new Map(
      deliveryRows.map((delivery) => [delivery.id, delivery.project_id ?? null] as const)
    )
    const projectById = new Map(projects.map((project) => [project.id, project] as const))
    const projectClientById = new Map(projects.map((project) => [project.id, project.client_id ?? null] as const))
    const clientById = new Map(clients.map((client) => [client.id, client] as const))

    /* Batch: fetch all delivery_assets and assets in 2 queries instead of 2N */
    const deliveryAssetFilter = deliveryIds.map((id) => `delivery_id.eq.${encodeURIComponent(id)}`).join(',')
    const allDeliveryAssets = await supabaseRequest<Array<{ delivery_id: string; asset_id: string }>>(
      c.env,
      `delivery_assets?or=(${deliveryAssetFilter})&select=delivery_id,asset_id`
    )

    /* Group asset IDs by delivery */
    const deliveryAssetMap = new Map<string, string[]>()
    for (const da of allDeliveryAssets) {
      const list = deliveryAssetMap.get(da.delivery_id) ?? []
      list.push(da.asset_id)
      deliveryAssetMap.set(da.delivery_id, list)
    }

    const allAssetIds = [...new Set(allDeliveryAssets.map((da) => da.asset_id))]
    const allAssets = allAssetIds.length
      ? await supabaseRequest<
          Array<{ id: string; filename: string; mime_type: string; bytes: number; r2_object_key: string }>
        >(
          c.env,
          `assets?or=(${allAssetIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',')})&select=id,filename,mime_type,bytes,r2_object_key&order=created_at.desc`
        )
      : []

    const assetById = new Map(allAssets.map((a) => [a.id, a]))

    const deliveryPayloads = activeRecipients.map((recipient) => {
      const deliveryId = recipient.delivery_id
      const projectId = deliveryToProject.get(deliveryId) ?? null
      const project = projectId ? projectById.get(projectId) ?? null : null
      const clientId = projectId ? projectClientById.get(projectId) ?? null : null
      const client = clientId ? clientById.get(clientId) ?? null : null
      const visibleAssetIds = deliveryAssetMap.get(deliveryId) ?? []

      const uploadedAssets = visibleAssetIds
        .map((id) => assetById.get(id))
        .filter((asset): asset is NonNullable<typeof asset> =>
          Boolean(asset && !asset.r2_object_key.startsWith('pending/'))
        )

      return {
        deliveryId,
        projectName: project?.name ?? null,
        clientName: client?.full_name ?? null,
        projectStatus: project?.status ?? null,
        accessMode: recipient.access_mode,
        expiresAt: recipient.expires_at,
        assets: uploadedAssets.map((asset) => ({
          ...asset,
          canView: true,
          canDownload: recipient.access_mode !== 'viewer',
        })),
      }
    })

    return c.json(
      {
        deliveries: deliveryPayloads,
      },
      200,
      responseHeaders(c)
    )
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load pictures', 400)
  }
})

/* ── Public portfolio media (no auth, long cache) ─────────────────── */
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

export default app
