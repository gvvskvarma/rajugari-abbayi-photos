import { Hono } from 'hono'
import type { Env, AdminActivityKind, AdminActivityRow } from '../types'
import { runLifecycle } from '../helpers/lifecycle'
import {
  adminActivityKinds, MAX_LONG_TEXT,
  responseHeaders, jsonError,
  supabaseRequest, getUserFromBearer, ensureAdmin, ensureAdminAndOwnedDelivery, ensureAdminOwnedAsset,
  insertAdminActivity, serializeAdminActivity,
  deleteStoredAssets, streamZipResponse,
  parseNullableText, parseProjectStatus, sanitizeArchiveEntryName,
  filterUuids, sendDeliveryReady, ensureAuthUser, generateSignInLink,
  getTokenSigningSecret, createProjectZipDownloadToken, verifyProjectZipDownloadToken,
} from '../lib'

const admin = new Hono<{ Bindings: Env }>()

/* ── Activity ──────────────────────────────────────────────────── */

admin.get('/activity', async (c) => {
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

admin.post('/activity', async (c) => {
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

/* ── Clients ───────────────────────────────────────────────────── */

admin.get('/clients', async (c) => {
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

/* ── Client deliveries with retention info (for the admin Retention panel) ──
   GET /api/v1/admin/clients/:clientId/deliveries */
admin.get('/clients/:clientId/deliveries', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    ensureAdmin(user)
    const clientId = c.req.param('clientId')
    if (!clientId) return jsonError('clientId is required', 400)

    const rows = await supabaseRequest<Array<{
      id: string
      status: string
      expires_at: string | null
      expired_at: string | null
      purged_at: string | null
      shared_at: string | null
      created_at: string
      projects: { name: string | null } | null
    }>>(
      c.env,
      `deliveries?owner_user_id=eq.${encodeURIComponent(user.id)}` +
        `&client_id=eq.${encodeURIComponent(clientId)}` +
        `&select=id,status,expires_at,expired_at,purged_at,shared_at,created_at,projects(name)` +
        `&order=created_at.desc`
    )

    /* Asset count + recipient emails per delivery, each in one batched query. */
    const ids = rows.map((r) => r.id)
    const counts = new Map<string, number>()
    const recipientsByDelivery = new Map<string, string[]>()
    if (ids.length) {
      const links = await supabaseRequest<Array<{ delivery_id: string }>>(
        c.env,
        `delivery_assets?or=(${ids.map((id) => `delivery_id.eq.${encodeURIComponent(id)}`).join(',')})&select=delivery_id`
      )
      for (const l of links) counts.set(l.delivery_id, (counts.get(l.delivery_id) ?? 0) + 1)

      const recips = await supabaseRequest<Array<{ delivery_id: string; email: string }>>(
        c.env,
        `delivery_recipients?or=(${ids.map((id) => `delivery_id.eq.${encodeURIComponent(id)}`).join(',')})&select=delivery_id,email`
      )
      for (const r of recips) {
        const list = recipientsByDelivery.get(r.delivery_id) ?? []
        list.push(r.email)
        recipientsByDelivery.set(r.delivery_id, list)
      }
    }

    const deliveries = rows.map((r) => ({
      deliveryId: r.id,
      title: r.projects?.name?.trim() || 'Untitled delivery',
      status: r.status,
      expiresAt: r.expires_at,
      expiredAt: r.expired_at,
      purgedAt: r.purged_at,
      sharedAt: r.shared_at,
      createdAt: r.created_at,
      assetCount: counts.get(r.id) ?? 0,
      recipients: recipientsByDelivery.get(r.id) ?? [],
    }))

    return c.json({ deliveries }, 200, responseHeaders(c))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load deliveries', 403)
  }
})

admin.post('/clients', async (c) => {
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

admin.patch('/clients/:clientId', async (c) => {
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

admin.delete('/clients/:clientId', async (c) => {
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

/* ── Projects ──────────────────────────────────────────────────── */

admin.get('/projects', async (c) => {
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

admin.post('/projects', async (c) => {
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

admin.patch('/projects/:projectId', async (c) => {
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

admin.delete('/projects/:projectId', async (c) => {
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

/* ── Project Download ──────────────────────────────────────────── */

admin.post('/projects/:projectId/download', async (c) => {
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

/* ── Bulk Download ─────────────────────────────────────────────── */

admin.post('/downloads', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    ensureAdmin(user)
    const body = await c.req.json<{ assetIds?: string[]; filename?: string }>()
    /* Validate UUIDs (interpolated into PostgREST or=() filter) and filter at
       SQL level rather than fetching every asset the admin owns. */
    const assetIds = [...new Set(filterUuids(body.assetIds ?? []))]
    if (assetIds.length === 0) return jsonError('assetIds are required', 400)

    const assetFilter = assetIds.map((id) => `id.eq.${id}`).join(',')
    const selectedAssets = await supabaseRequest<Array<{ id: string; filename: string; r2_object_key: string }>>(
      c.env,
      `assets?owner_user_id=eq.${encodeURIComponent(user.id)}&or=(${assetFilter})&select=id,filename,r2_object_key,created_at&order=created_at.asc`
    )

    if (selectedAssets.length === 0) return jsonError('No matching assets found', 404)

    const archiveName = `${sanitizeArchiveEntryName(body.filename ?? 'selected-files')}.zip`
    return streamZipResponse(c, selectedAssets, archiveName)
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Download failed', 400)
  }
})

/* ── Native project ZIP download (admin, token-authed GET) ───────────
   The admin POSTs (bearer) to mint a signed token for a whole project,
   then navigates to the GET endpoint so the browser streams the zip to
   disk natively — no in-memory blob, any size. */
admin.post('/downloads/token', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    ensureAdmin(user)
    const body = await c.req.json<{ projectId?: string; filename?: string }>().catch(() => ({} as { projectId?: string; filename?: string }))
    const projectId = (body.projectId ?? '').trim()
    if (!projectId) return jsonError('projectId is required', 400)

    /* Confirm the project belongs to this admin before minting a token. */
    const rows = await supabaseRequest<Array<{ id: string }>>(
      c.env,
      `projects?id=eq.${encodeURIComponent(projectId)}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`
    )
    if (!rows[0]) return jsonError('Project not found', 404)

    const rawName = typeof body.filename === 'string' && body.filename.trim() ? body.filename.trim() : 'photos'
    const filename = `${sanitizeArchiveEntryName(rawName).replace(/\.zip$/i, '')}.zip`
    const now = Date.now()
    const token = await createProjectZipDownloadToken(getTokenSigningSecret(c.env), {
      v: 1,
      projectId,
      ownerUserId: user.id,
      filename,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 15 * 60 * 1000).toISOString(),
    })
    return c.json({ token, path: `/api/v1/admin/downloads/file?token=${encodeURIComponent(token)}` }, 200, responseHeaders(c))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not prepare download'
    const status = /bearer token|session token/i.test(message) ? 401 : /admin access/i.test(message) ? 403 : 400
    return jsonError(message, status)
  }
})

admin.get('/downloads/file', async (c) => {
  try {
    const token = c.req.query('token')
    if (!token) return jsonError('token is required', 400)
    const payload = await verifyProjectZipDownloadToken(getTokenSigningSecret(c.env), token)

    const assets = await supabaseRequest<Array<{ id: string; filename: string; r2_object_key: string }>>(
      c.env,
      `assets?owner_user_id=eq.${encodeURIComponent(payload.ownerUserId)}&project_id=eq.${encodeURIComponent(payload.projectId)}&select=id,filename,r2_object_key,created_at&order=created_at.asc`
    )
    const uploaded = assets.filter((a) => !a.r2_object_key.startsWith('pending/'))
    if (uploaded.length === 0) return jsonError('No files available for download', 404)
    return streamZipResponse(c, uploaded, payload.filename)
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Download failed', 400)
  }
})

/* ── Asset Delete ──────────────────────────────────────────────── */

admin.delete('/assets/:assetId', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    const assetId = c.req.param('assetId')
    if (!assetId) return jsonError('assetId is required', 400)

    const asset = await ensureAdminOwnedAsset(c.env, user, assetId)

    /* DB first, then R2 — orphaned R2 files are harmless (storage cost only),
       but orphaned DB rows pointing at missing files break galleries. */
    await supabaseRequest(
      c.env,
      `assets?id=eq.${encodeURIComponent(assetId)}&owner_user_id=eq.${encodeURIComponent(user.id)}`,
      {
        method: 'DELETE',
      },
      true
    )

    if (!asset.r2_object_key.startsWith('pending/')) {
      try {
        await c.env.R2_MEDIA_BUCKET.delete(asset.r2_object_key)
      } catch (r2Error) {
        // Log but don't fail — DB row is gone, the file is now orphaned
        // and can be cleaned up by a background job.
        console.error('[asset-delete] R2 cleanup failed:', asset.r2_object_key, r2Error)
      }
    }

    return c.json({ ok: true, assetId }, 200, responseHeaders(c))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Asset delete failed', 400)
  }
})

/* ── Client notification (email + magic-link) ───────────────────────
   POST /api/v1/admin/deliveries/:deliveryId/notify

   Sends a branded "your photos are ready" email to the delivery's client.
   The email contains a Supabase-minted magic link that signs the client
   in on click and lands them on /my-pictures.

   Flow:
     1. Auth — admin + delivery ownership.
     2. Resolve client email + name + delivery title + asset count.
     3. Mint magic link via Supabase admin generate_link API.
     4. Send email via Resend.
     5. Audit: insert delivery_recipients (idempotent on conflict),
        stamp deliveries.shared_at, log admin_activity_events.

   503 if email isn't configured yet (RESEND_API_KEY / EMAIL_FROM unset) —
   this lets the route ship before the domain is verified without crashing
   admin flows. 400 if the client has no email on file. 404 if the delivery
   doesn't belong to this admin.
─────────────────────────────────────────────────────────────────── */

/** First name, capitalized for a polished greeting ("aarav kumar" -> "Aarav"). */
const firstName = (fullName: string | null | undefined): string => {
  const trimmed = (fullName ?? '').trim()
  if (!trimmed) return ''
  const first = trimmed.split(/\s+/)[0]
  return first.charAt(0).toUpperCase() + first.slice(1)
}

admin.post('/deliveries/:deliveryId/notify', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    ensureAdmin(user)

    if (!c.env.RESEND_API_KEY || !c.env.EMAIL_FROM) {
      return jsonError('Email is not configured yet. Add RESEND_API_KEY and EMAIL_FROM, then redeploy.', 503)
    }

    const deliveryId = c.req.param('deliveryId')
    if (!deliveryId) return jsonError('deliveryId is required', 400)

    /* Verifies the delivery exists and is owned by this admin. Throws otherwise. */
    await ensureAdminAndOwnedDelivery(c.env, user, deliveryId)

    /* Pull all the metadata we need for the email in a single round-trip
       per row. PostgREST embedded resources keep the joins server-side. */
    const rows = await supabaseRequest<Array<{
      id: string
      client_id: string
      project_id: string
      clients: { id: string; email: string; full_name: string } | null
      projects: { id: string; name: string } | null
    }>>(
      c.env,
      `deliveries?id=eq.${encodeURIComponent(deliveryId)}&select=id,client_id,project_id,clients(id,email,full_name),projects(id,name)&limit=1`
    )
    const delivery = rows[0]
    if (!delivery) return jsonError('Delivery not found', 404)
    if (!delivery.clients?.email) {
      return jsonError('Client has no email on file. Add one and try again.', 400)
    }

    const clientEmail = delivery.clients.email.trim().toLowerCase()
    const clientName = firstName(delivery.clients.full_name)
    const deliveryTitle = delivery.projects?.name?.trim() || 'your shoot'

    /* Count files in this delivery so the email can show "37 photos".
       Freelance shoots are O(100s) of photos — a SELECT-and-count is
       fine. We pull only asset_id to keep the payload minimal. */
    const assetRows = await supabaseRequest<Array<{ asset_id: string }>>(
      c.env,
      `delivery_assets?delivery_id=eq.${encodeURIComponent(deliveryId)}&select=asset_id`
    )
    const assetCount = assetRows.length

    /* Guard: don't email "your photos are ready" for an empty delivery.
       This catches a mis-click on a draft before any files finished
       uploading. */
    if (assetCount === 0) {
      return jsonError('This delivery has no photos yet. Upload files before notifying the client.', 400)
    }

    /* Ensure the client has an auth user BEFORE minting the magic link —
       generate_link(magiclink) only works for existing users, and most
       notified clients are brand new (never logged in). Idempotent. */
    await ensureAuthUser(c.env, clientEmail)

    /* Mint the magic link (points at our /auth/callback, which verifies the
       token and forwards to /my-pictures). */
    const magicLink = await generateSignInLink(c.env, clientEmail)

    /* Fire the email. This is the irreversible commit point: once it
       succeeds, the client has been notified. Errors here surface as 500
       so the admin can retry. */
    const result = await sendDeliveryReady(c.env, {
      to: clientEmail,
      clientName,
      deliveryTitle,
      magicLink,
      assetCount,
    })

    /* Post-send bookkeeping is BEST-EFFORT. The email already went out, so a
       failed audit write must NOT 500 the request — otherwise the admin
       retries and the client gets a duplicate email. We log failures and
       still return success. */
    try {
      /* Record the recipient. UNIQUE(delivery_id, email) → ignore duplicates
         so legit re-sends don't error. */
      await supabaseRequest(
        c.env,
        'delivery_recipients?on_conflict=delivery_id,email',
        {
          method: 'POST',
          headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify({ delivery_id: deliveryId, email: clientEmail }),
        },
        true
      )

      /* Stamp shared_at only if null — preserves the first-shared timestamp. */
      await supabaseRequest(
        c.env,
        `deliveries?id=eq.${encodeURIComponent(deliveryId)}&shared_at=is.null`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ shared_at: result.sentAt }),
        },
        true
      )

      /* Log to the admin activity feed. */
      await insertAdminActivity(c.env, {
        ownerUserId: user.id,
        kind: 'edit',
        title: 'Notified client',
        detail: `Sent "${deliveryTitle}" link to ${clientEmail}`,
        clientId: delivery.client_id,
        projectId: delivery.project_id,
        metadata: { messageId: result.messageId, assetCount },
      })
    } catch (auditError) {
      /* Visible in `wrangler tail` / Sentry but never fails the send. */
      console.error('[notify] post-send bookkeeping failed (email already sent):', auditError)
    }

    return c.json(
      {
        ok: true,
        deliveryId,
        recipientEmail: clientEmail,
        messageId: result.messageId,
        sentAt: result.sentAt,
      },
      200,
      responseHeaders(c)
    )
  } catch (error) {
    /* Map known failure classes to honest status codes. Auth/authorization
       and not-found errors are client errors (4xx); anything else (Supabase
       down, Resend down, unexpected) is a genuine 5xx. Returning 500 for an
       auth failure would mislead monitoring and the admin UI. */
    const message = error instanceof Error ? error.message : 'Failed to notify client'
    const status =
      /bearer token|session token|not available in session/i.test(message) ? 401 :
      /admin access/i.test(message) ? 403 :
      /not found|not owned/i.test(message) ? 404 :
      500
    return jsonError(message, status)
  }
})

/* ── Share with an additional recipient (e.g. family member) ─────────
   POST /api/v1/admin/deliveries/:deliveryId/recipients   { email, name? }

   Grants another email full ("owner") access to an already-uploaded
   delivery and sends them the same "your photos are ready" magic-link
   email the primary client received. They sign in via the link and see the
   gallery at /my-pictures exactly like the client. Retention/expiry applies
   automatically (gated at the delivery level).

   Unlike notify, we insert the recipient row BEFORE sending the email: the
   recipient row is what grants access, so it must exist when they click. The
   insert is idempotent (UNIQUE delivery_id,email), so a retry after an email
   failure is clean. */
admin.post('/deliveries/:deliveryId/recipients', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    ensureAdmin(user)

    if (!c.env.RESEND_API_KEY || !c.env.EMAIL_FROM) {
      return jsonError('Email is not configured yet. Add RESEND_API_KEY and EMAIL_FROM, then redeploy.', 503)
    }

    const deliveryId = c.req.param('deliveryId')
    if (!deliveryId) return jsonError('deliveryId is required', 400)
    await ensureAdminAndOwnedDelivery(c.env, user, deliveryId)

    const body = await c.req.json<{ email?: string; name?: string }>()
    const email = (body.email ?? '').trim().toLowerCase()
    if (!email || !email.includes('@') || email.length > 254) {
      return jsonError('A valid email is required', 400)
    }
    const recipientName = firstName(body.name ?? '')

    /* Delivery metadata for the email + a guard against sharing an empty or
       already-expired/purged delivery. */
    const rows = await supabaseRequest<Array<{
      id: string
      client_id: string
      project_id: string
      expired_at: string | null
      purged_at: string | null
      projects: { name: string } | null
    }>>(
      c.env,
      `deliveries?id=eq.${encodeURIComponent(deliveryId)}&select=id,client_id,project_id,expired_at,purged_at,projects(name)&limit=1`
    )
    const delivery = rows[0]
    if (!delivery) return jsonError('Delivery not found', 404)
    if (delivery.purged_at) return jsonError('These files have been removed and can no longer be shared.', 409)
    if (delivery.expired_at) return jsonError('This delivery has expired. Extend it first, then share.', 409)

    const deliveryTitle = delivery.projects?.name?.trim() || 'your shoot'
    const assetRows = await supabaseRequest<Array<{ asset_id: string }>>(
      c.env,
      `delivery_assets?delivery_id=eq.${encodeURIComponent(deliveryId)}&select=asset_id`
    )
    const assetCount = assetRows.length
    if (assetCount === 0) {
      return jsonError('This delivery has no photos yet.', 400)
    }

    /* 1. Grant access FIRST (idempotent) so the link works the moment they
       click. access_mode 'owner' = full view + download + reshare, same as
       the primary client. */
    await ensureAuthUser(c.env, email)
    await supabaseRequest(
      c.env,
      'delivery_recipients?on_conflict=delivery_id,email',
      {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify({ delivery_id: deliveryId, email, access_mode: 'owner' }),
      },
      true
    )

    /* 2. Send the same delivery-ready email with a magic link. */
    const magicLink = await generateSignInLink(c.env, email)
    const result = await sendDeliveryReady(c.env, {
      to: email,
      clientName: recipientName,
      deliveryTitle,
      magicLink,
      assetCount,
    })

    /* 3. Audit (best-effort). */
    try {
      await insertAdminActivity(c.env, {
        ownerUserId: user.id,
        kind: 'edit',
        title: 'Shared with family',
        detail: `Shared "${deliveryTitle}" with ${email}`,
        clientId: delivery.client_id,
        projectId: delivery.project_id,
        metadata: { messageId: result.messageId, email },
      })
    } catch (auditError) {
      console.error('[recipients] audit failed (email already sent):', auditError)
    }

    return c.json(
      { ok: true, deliveryId, recipientEmail: email, messageId: result.messageId, sentAt: result.sentAt },
      200,
      responseHeaders(c)
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to share delivery'
    const status =
      /bearer token|session token|not available in session/i.test(message) ? 401 :
      /admin access/i.test(message) ? 403 :
      /not found|not owned/i.test(message) ? 404 :
      500
    return jsonError(message, status)
  }
})

/* ── Extend retention ───────────────────────────────────────────────
   POST /api/v1/admin/deliveries/:deliveryId/extend

   Pushes a delivery's expiry RETENTION_DAYS into the future and clears the
   warning flag. If the delivery was soft-deleted but not yet purged, this
   also restores client access (clears expired_at + status). No-op once a
   delivery has been purged (files are already gone). */
admin.post('/deliveries/:deliveryId/extend', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    ensureAdmin(user)
    const deliveryId = c.req.param('deliveryId')
    if (!deliveryId) return jsonError('deliveryId is required', 400)
    await ensureAdminAndOwnedDelivery(c.env, user, deliveryId)

    const rows = await supabaseRequest<Array<{ id: string; purged_at: string | null; client_id: string; project_id: string }>>(
      c.env,
      `deliveries?id=eq.${encodeURIComponent(deliveryId)}&select=id,purged_at,client_id,project_id&limit=1`
    )
    const delivery = rows[0]
    if (!delivery) return jsonError('Delivery not found', 404)
    if (delivery.purged_at) {
      return jsonError('These files have already been permanently removed and cannot be restored.', 409)
    }

    const RETENTION_DAYS = 45
    const newExpiry = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
    await supabaseRequest(
      c.env,
      `deliveries?id=eq.${encodeURIComponent(deliveryId)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        /* Clear expired_at + warning so a soft-deleted delivery comes back and
           re-arms a fresh warning before the new cutoff. */
        body: JSON.stringify({ expires_at: newExpiry, expired_at: null, expiry_warning_sent_at: null, status: 'shared' }),
      },
      true
    )

    await insertAdminActivity(c.env, {
      ownerUserId: user.id,
      kind: 'edit',
      title: 'Extended retention',
      detail: `Extended delivery to ${new Date(newExpiry).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
      clientId: delivery.client_id,
      projectId: delivery.project_id,
      metadata: { expiresAt: newExpiry },
    })

    return c.json({ ok: true, deliveryId, expiresAt: newExpiry }, 200, responseHeaders(c))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to extend retention'
    const status =
      /bearer token|session token|not available in session/i.test(message) ? 401 :
      /admin access/i.test(message) ? 403 :
      /not found|not owned/i.test(message) ? 404 :
      500
    return jsonError(message, status)
  }
})

/* ── Manual lifecycle trigger (admin) ───────────────────────────────
   POST /api/v1/admin/lifecycle/run

   Runs the retention lifecycle on demand and returns the report. Respects
   LIFECYCLE_DRY_RUN exactly like the cron, so it's safe to call for
   verification — in dry-run it only logs/reports, changing nothing. */
admin.post('/lifecycle/run', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    ensureAdmin(user)
    const report = await runLifecycle(c.env)
    return c.json(report, 200, responseHeaders(c))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lifecycle run failed'
    const status =
      /bearer token|session token|not available in session/i.test(message) ? 401 :
      /admin access/i.test(message) ? 403 :
      500
    return jsonError(message, status)
  }
})

export { admin }
