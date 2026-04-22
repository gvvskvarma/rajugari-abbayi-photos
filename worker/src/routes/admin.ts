import { Hono } from 'hono'
import type { Env, AdminActivityKind, AdminActivityRow } from '../types'
import {
  adminActivityKinds, MAX_LONG_TEXT,
  responseHeaders, jsonError,
  supabaseRequest, getUserFromBearer, ensureAdmin, ensureAdminOwnedAsset,
  insertAdminActivity, serializeAdminActivity,
  deleteStoredAssets, streamZipResponse,
  parseNullableText, parseProjectStatus, sanitizeArchiveEntryName,
  filterUuids,
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

export { admin }
