import { Hono } from 'hono'
import type { Env, AdminActivityKind, AdminActivityRow } from '../types'
import {
  adminActivityKinds, MAX_LONG_TEXT,
  responseHeaders, jsonError,
  supabaseRequest, getUserFromBearer, ensureAdmin, ensureAdminAndOwnedDelivery, ensureAdminOwnedAsset,
  insertAdminActivity, serializeAdminActivity,
  deleteStoredAssets, streamZipResponse,
  parseNullableText, parseProjectStatus, sanitizeArchiveEntryName,
  filterUuids, sendDeliveryReady,
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

type GenerateLinkResponse = {
  properties?: {
    action_link?: string
    hashed_token?: string
  }
  action_link?: string
  hashed_token?: string
}

/**
 * Ensure an auth user exists for this email before we mint a magic link.
 *
 * Why this is necessary: the admin `generate_link` endpoint with
 * type `magiclink` only works for users that already exist. But this
 * feature's whole purpose is emailing *new* clients who have never logged
 * in — they have no `auth.users` row yet. The existing customer login uses
 * `signInWithOtp({ shouldCreateUser: true })`, which auto-creates; the admin
 * API does not. So we create the user up front (idempotently) to match.
 *
 * `email_confirm: true` marks the email as verified so the magic link works
 * immediately — same shape as a passwordless user created via OTP signup.
 * A 422 "already been registered" is the expected happy path on repeat sends
 * and is swallowed.
 */
const ensureAuthUser = async (env: Env, email: string): Promise<void> => {
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, email_confirm: true }),
  })
  if (response.ok) return
  const body = await response.text()
  /* User already exists → exactly what we want. GoTrue returns 422 with an
     "already been registered" / "already exists" message. Treat as success. */
  if (response.status === 422 || /already.*(registered|exist)/i.test(body)) return
  throw new Error(`Supabase create user failed (${response.status}): ${body.slice(0, 200)}`)
}

/**
 * Mint a sign-in `token_hash` via Supabase admin generate_link, then build a
 * link to our own `/auth/callback` route.
 *
 * Why token_hash and not the default `action_link`: the action_link drives
 * the PKCE `?code=` flow, which requires a code verifier stored in the
 * client's browser when the login was *initiated there*. But this link is
 * minted server-side and clicked by a client who never started a login in
 * their browser — so there's no verifier, and the auto-exchange fails
 * silently (the client appears signed in to Supabase but the SPA session
 * never hydrates, forcing a second manual login). The `token_hash` is
 * verified client-side via `verifyOtp`, which needs no verifier. Our
 * `/auth/callback` page does that verification and forwards to the gallery.
 *
 * Call `ensureAuthUser` first — magiclink requires the user to exist.
 *
 * Expiry is governed by the project's Auth → Email OTP setting. Supabase
 * recommends ≤1h (3600s); the email copy says "1 hour" to match, and the
 * "reply for a fresh link" line covers an expired click.
 */
const generateSignInLink = async (env: Env, email: string): Promise<string> => {
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Supabase generate_link failed (${response.status}): ${body.slice(0, 200)}`)
  }
  const payload = (await response.json()) as GenerateLinkResponse
  const tokenHash = payload.properties?.hashed_token ?? payload.hashed_token
  if (!tokenHash) throw new Error('Supabase generate_link returned no hashed_token')

  /* Build a link to our own callback. `next` is the gallery; the callback
     verifies token_hash, sets the session, then forwards there.
     type=email is the canonical value for verifyOtp on a magic-link
     token_hash (per Supabase docs) — NOT "magiclink", which fails. */
  const next = encodeURIComponent('/my-pictures')
  return `${env.APP_ORIGIN}/auth/callback?token_hash=${encodeURIComponent(tokenHash)}&type=email&next=${next}`
}

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

export { admin }
