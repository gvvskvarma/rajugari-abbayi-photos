import { Hono } from 'hono'
import type { Context } from 'hono'

type Role = 'admin' | 'customer'
type Mode = 'view' | 'download'

type Env = {
  R2_MEDIA_BUCKET: R2Bucket
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  R2_ACCOUNT_ID: string
  R2_BUCKET: string
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
  APP_ORIGIN: string
}

type User = {
  id: string
  email: string
  role: Role
}

const app = new Hono<{ Bindings: Env }>()

const rateWindowMs = 60_000
const maxUploadBytes = 5 * 1024 * 1024 * 1024
const uploadUrlExpirySeconds = 900
const routeRateLimits = new Map<string, { count: number; windowStart: number }>()

const jsonError = (message: string, status = 400) =>
  new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const baseHeaders = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type,authorization',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
}

app.options('*', (c) => c.body(null, 204, baseHeaders))

app.use('/api/*', async (c, next) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'
  const routeKey = `${ip}:${new URL(c.req.url).pathname}`
  const current = routeRateLimits.get(routeKey)
  const now = Date.now()

  if (!current || now - current.windowStart > rateWindowMs) {
    routeRateLimits.set(routeKey, { count: 1, windowStart: now })
  } else {
    current.count += 1
    if (current.count > 60) {
      return jsonError('Rate limit exceeded', 429)
    }
  }

  await next()
})

const supabaseRequest = async <T>(
  env: Env,
  path: string,
  init?: RequestInit,
  useServiceRole = true
): Promise<T> => {
  const url = `${env.SUPABASE_URL}/rest/v1/${path}`
  const apiKey = useServiceRole ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Supabase request failed (${response.status}): ${text}`)
  }

  if (response.status === 204) return {} as T
  return (await response.json()) as T
}

const getUserFromBearer = async (env: Env, authHeader?: string): Promise<User> => {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing bearer token')
  }
  const jwt = authHeader.slice('Bearer '.length)

  const authRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${jwt}`,
    },
  })

  if (!authRes.ok) {
    throw new Error('Invalid session token')
  }

  const authUser = (await authRes.json()) as { id: string; email?: string }
  const email = (authUser.email ?? '').toLowerCase()
  if (!email) throw new Error('Email not available in session')

  const profiles = await supabaseRequest<Array<{ role: 'admin' | 'client' }>>(
    env,
    `profiles?id=eq.${encodeURIComponent(authUser.id)}&select=role&limit=1`
  )

  const role = profiles[0]?.role === 'admin' ? 'admin' : 'customer'
  return { id: authUser.id, email, role }
}

const toHex = (buffer: ArrayBuffer | ArrayBufferLike | Uint8Array): string => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const sha256Hex = async (value: string): Promise<string> => {
  const data = new TextEncoder().encode(value)
  return toHex(await crypto.subtle.digest('SHA-256', data))
}

const hmacSha256 = async (key: Uint8Array, value: string): Promise<Uint8Array> => {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value))
  return new Uint8Array(sig)
}

const asUtcDateParts = (date: Date) => {
  const yyyy = date.getUTCFullYear().toString().padStart(4, '0')
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0')
  const dd = date.getUTCDate().toString().padStart(2, '0')
  const hh = date.getUTCHours().toString().padStart(2, '0')
  const mi = date.getUTCMinutes().toString().padStart(2, '0')
  const ss = date.getUTCSeconds().toString().padStart(2, '0')
  return {
    dateStamp: `${yyyy}${mm}${dd}`,
    amzDate: `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`,
  }
}

const buildR2SignedUrl = async (
  env: Env,
  method: 'GET' | 'PUT',
  objectKey: string,
  expiresInSec: number,
  mode: Mode
) => {
  const now = new Date()
  const { dateStamp, amzDate } = asUtcDateParts(now)
  const region = 'auto'
  const service = 's3'
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  const encodedKey = objectKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  const canonicalUri = `/${env.R2_BUCKET}/${encodedKey}`

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const baseParams = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${env.R2_ACCESS_KEY_ID}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresInSec),
    'X-Amz-SignedHeaders': 'host',
  })

  if (mode === 'download' && method === 'GET') {
    baseParams.set('response-content-disposition', 'attachment')
  }

  const canonicalQuery = [...baseParams.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  const canonicalHeaders = `host:${host}\n`
  const signedHeaders = 'host'
  const payloadHash = 'UNSIGNED-PAYLOAD'

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const canonicalRequestHash = await sha256Hex(canonicalRequest)
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, canonicalRequestHash].join('\n')

  const kDate = await hmacSha256(new TextEncoder().encode(`AWS4${env.R2_SECRET_ACCESS_KEY}`), dateStamp)
  const kRegion = await hmacSha256(kDate, region)
  const kService = await hmacSha256(kRegion, service)
  const kSigning = await hmacSha256(kService, 'aws4_request')
  const signature = toHex(await hmacSha256(kSigning, stringToSign).then((x) => x.buffer))

  baseParams.set('X-Amz-Signature', signature)
  return `https://${host}${canonicalUri}?${baseParams.toString()}`
}

const ensureAdminAndOwnedDelivery = async (env: Env, user: User, deliveryId: string) => {
  if (user.role !== 'admin') throw new Error('Admin access required')

  const deliveries = await supabaseRequest<Array<{ id: string }>>(
    env,
    `deliveries?id=eq.${encodeURIComponent(deliveryId)}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`
  )

  if (!deliveries[0]) {
    throw new Error('Delivery not found or not owned by admin')
  }
}

const ensureDeliveryAccess = async (
  env: Env,
  user: User,
  deliveryId: string,
  mode: Mode
): Promise<'owner' | 'viewer' | 'admin'> => {
  if (user.role === 'admin') {
    const adminDeliveries = await supabaseRequest<Array<{ id: string }>>(
      env,
      `deliveries?id=eq.${encodeURIComponent(deliveryId)}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`
    )
    if (adminDeliveries[0]) return 'admin'
  }

  const recipients = await supabaseRequest<
    Array<{ access_mode: 'owner' | 'viewer'; expires_at: string | null }>
  >(
    env,
    `delivery_recipients?delivery_id=eq.${encodeURIComponent(deliveryId)}&email=eq.${encodeURIComponent(
      user.email
    )}&select=access_mode,expires_at&limit=1`
  )

  const recipient = recipients[0]
  if (!recipient) throw new Error('No access to this delivery')

  if (recipient.expires_at && new Date(recipient.expires_at).getTime() <= Date.now()) {
    throw new Error('Delivery has expired')
  }

  if (mode === 'download' && recipient.access_mode !== 'owner') {
    throw new Error('Download not allowed for viewer access')
  }

  return recipient.access_mode
}

const ensureAdmin = (user: User) => {
  if (user.role !== 'admin') {
    throw new Error('Admin access required')
  }
}

const parseNullableText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const sanitizeFileName = (fileName: string): string => fileName.replace(/[^a-zA-Z0-9._-]/g, '_')

const parseProjectStatus = (
  value: unknown
): 'draft' | 'active' | 'completed' | 'archived' | undefined => {
  if (
    value === 'draft' ||
    value === 'active' ||
    value === 'completed' ||
    value === 'archived'
  ) {
    return value
  }
  return undefined
}

app.get('/api/v1/health', (c) =>
  c.json(
    {
      ok: true,
      service: 'photography-api',
      timestamp: new Date().toISOString(),
    },
    200,
    baseHeaders
  )
)

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
      baseHeaders
    )
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load profile', 401)
  }
})

app.get('/api/v1/admin/clients', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    ensureAdmin(user)

    const clients = await supabaseRequest<
      Array<{ id: string; full_name: string; email: string; phone: string | null; notes: string | null }>
    >(c.env, `clients?owner_user_id=eq.${encodeURIComponent(user.id)}&select=id,full_name,email,phone,notes&order=created_at.desc`)

    return c.json({ clients }, 200, baseHeaders)
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
          notes: parseNullableText(body.notes),
        }),
      }
    )

    return c.json({ client: inserted[0] }, 201, baseHeaders)
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
    if (typeof body.notes === 'string') payload.notes = parseNullableText(body.notes)
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
    return c.json({ client: updated[0] }, 200, baseHeaders)
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

    await supabaseRequest(
      c.env,
      `clients?id=eq.${encodeURIComponent(clientId)}&owner_user_id=eq.${encodeURIComponent(user.id)}`,
      {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      }
    )

    return c.json({ ok: true }, 200, baseHeaders)
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

    return c.json({ projects }, 200, baseHeaders)
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
          description: parseNullableText(body.description),
          shoot_date: parseNullableText(body.shootDate),
          location: parseNullableText(body.location),
          status: parseProjectStatus(body.status) ?? 'draft',
        }),
      }
    )

    return c.json({ project: inserted[0] }, 201, baseHeaders)
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
    if (typeof body.description === 'string') payload.description = parseNullableText(body.description)
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
    return c.json({ project: updated[0] }, 200, baseHeaders)
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

    await supabaseRequest(
      c.env,
      `projects?id=eq.${encodeURIComponent(projectId)}&owner_user_id=eq.${encodeURIComponent(user.id)}`,
      {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      }
    )

    return c.json({ ok: true }, 200, baseHeaders)
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

    await supabaseRequest(
      c.env,
      'upload_sessions',
      {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          owner_user_id: user.id,
          delivery_id: body.deliveryId,
          project_id: projectId,
          upload_token: uploadToken,
          original_filename: safeFileName,
          mime_type: body.contentType,
          expected_bytes: Math.max(1, Math.trunc(body.fileSize)),
          r2_object_key: objectKey,
          status: 'requested',
          expires_at: expiresAt,
        }),
      },
      true
    )

    return c.json(
      {
        objectKey,
        uploadToken,
        uploadUrl,
        expiresInSeconds: uploadUrlExpirySeconds,
        maxFileBytes: maxUploadBytes,
      },
      200,
      baseHeaders
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

    const sessions = await supabaseRequest<
      Array<{
        id: string
        status: 'requested' | 'uploaded' | 'finalized' | 'failed'
        expires_at: string
        expected_bytes: number
      }>
    >(
      c.env,
      `upload_sessions?upload_token=eq.${encodeURIComponent(
        body.uploadToken
      )}&owner_user_id=eq.${encodeURIComponent(user.id)}&delivery_id=eq.${encodeURIComponent(
        body.deliveryId
      )}&r2_object_key=eq.${encodeURIComponent(body.objectKey)}&select=id,status,expires_at,expected_bytes&limit=1`
    )
    const session = sessions[0]
    if (!session) return jsonError('Upload session not found', 404)
    if (new Date(session.expires_at).getTime() <= Date.now()) return jsonError('Upload session expired', 410)
    if (session.status === 'finalized') return jsonError('Upload session already finalized', 409)
    if (Math.abs(session.expected_bytes - body.bytes) > Math.max(1024, session.expected_bytes * 0.02)) {
      return jsonError('Uploaded byte count does not match requested file size', 400)
    }

    const deliveries = await supabaseRequest<Array<{ project_id: string }>>(
      c.env,
      `deliveries?id=eq.${encodeURIComponent(body.deliveryId)}&select=project_id&limit=1`
    )
    const projectId = deliveries[0]?.project_id
    if (!projectId) return jsonError('Delivery project not found', 404)

    const kind = body.mimeType.startsWith('video/') ? 'video' : 'photo'

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

    await supabaseRequest(
      c.env,
      `upload_sessions?id=eq.${encodeURIComponent(session.id)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'finalized',
          completed_at: new Date().toISOString(),
          attempts: 1,
        }),
      },
      true
    )

    return c.json(
      {
        ok: true,
        assetId: insertedAssets[0]?.id ?? null,
        uploadSessionId: session.id,
      },
      200,
      baseHeaders
    )
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Upload finalize failed', 400)
  }
})

app.post('/api/v1/media/signed-url', async (c) => {
  try {
    const authHeader = c.req.header('authorization')
    const body = await c.req.json<{ assetId: string; mode?: Mode; shareToken?: string }>()
    const mode: Mode = body.mode === 'download' ? 'download' : 'view'

    if (!body.assetId) return jsonError('assetId is required', 400)

    const assets = await supabaseRequest<
      Array<{ id: string; delivery_id: string; r2_object_key: string; mime_type: string }>
    >(
      c.env,
      `assets?id=eq.${encodeURIComponent(body.assetId)}&select=id,delivery_id,r2_object_key,mime_type&limit=1`
    )

    const asset = assets[0]
    if (!asset) return jsonError('Asset not found', 404)

    if (body.shareToken) {
      const links = await supabaseRequest<
        Array<{ delivery_id: string; allow_download: boolean; expires_at: string }>
      >(
        c.env,
        `share_links?token=eq.${encodeURIComponent(
          body.shareToken
        )}&select=delivery_id,allow_download,expires_at&limit=1`
      )
      const link = links[0]
      if (!link) return jsonError('Invalid share token', 403)
      if (new Date(link.expires_at).getTime() <= Date.now()) return jsonError('Share link expired', 403)
      if (link.delivery_id !== asset.delivery_id) return jsonError('Asset not in shared delivery', 403)
      if (mode === 'download' && !link.allow_download) return jsonError('Download not allowed', 403)

      const signedUrl = await buildR2SignedUrl(c.env, 'GET', asset.r2_object_key, 300, mode)
      return c.json({ signedUrl, expiresInSeconds: 300, mode }, 200, baseHeaders)
    }

    const user = await getUserFromBearer(c.env, authHeader)
    await ensureDeliveryAccess(c.env, user, asset.delivery_id, mode)

    const signedUrl = await buildR2SignedUrl(c.env, 'GET', asset.r2_object_key, 300, mode)
    return c.json({ signedUrl, expiresInSeconds: 300, mode }, 200, baseHeaders)
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Signed URL request failed', 400)
  }
})

app.post('/api/v1/share-links', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    const body = await c.req.json<{ deliveryId: string; expiresInDays?: number }>()
    if (!body.deliveryId) return jsonError('deliveryId is required', 400)

    const accessMode = await ensureDeliveryAccess(c.env, user, body.deliveryId, 'view')
    if (accessMode === 'viewer') {
      return jsonError('Viewer accounts cannot create share links', 403)
    }

    const days = Math.min(30, Math.max(1, body.expiresInDays ?? 7))
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    const token = crypto.randomUUID().replace(/-/g, '')

    const inserted = await supabaseRequest<Array<{ token: string }>>(
      c.env,
      'share_links?select=token',
      {
        method: 'POST',
        body: JSON.stringify({
          token,
          owner_profile_id: user.id,
          delivery_id: body.deliveryId,
          access_mode: 'viewer',
          allow_download: false,
          expires_at: expiresAt,
        }),
      },
      true
    )

    return c.json(
      {
        token: inserted[0]?.token ?? token,
        url: `${c.env.APP_ORIGIN}/#share/${inserted[0]?.token ?? token}`,
        expiresAt,
      },
      200,
      baseHeaders
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

    const activeDeliveryIds = recipients
      .filter((row) => !row.expires_at || new Date(row.expires_at).getTime() > Date.now())
      .map((row) => row.delivery_id)

    if (activeDeliveryIds.length === 0) {
      return c.json({ deliveries: [] }, 200, baseHeaders)
    }

    const filter = activeDeliveryIds.map((id) => `delivery_id.eq.${id}`).join(',')
    const assets = await supabaseRequest<
      Array<{ id: string; delivery_id: string; filename: string; mime_type: string; bytes: number }>
    >(
      c.env,
      `assets?or=(${filter})&select=id,delivery_id,filename,mime_type,bytes&order=created_at.desc`
    )

    return c.json(
      {
        deliveries: activeDeliveryIds.map((deliveryId) => ({
          deliveryId,
          assets: assets.filter((asset) => asset.delivery_id === deliveryId),
        })),
      },
      200,
      baseHeaders
    )
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load pictures', 400)
  }
})

export default app
