import type { Context } from 'hono'
import type {
  Env, Mode, MediaVariant, PreviewAccessContext, AdminActivityKind, AdminActivityRow, DeliveryAssetRule,
} from './types'
import {
  responseHeaders,
  supabaseRequest,
} from './helpers/http'
import {
  createPreviewToken,
  getTokenSigningSecret,
} from './helpers/tokens'
import {
  ensureAdmin,
  ensureAdminAndOwnedDelivery,
  ensureAdminOwnedAsset,
  ensureDeliveryAccess,
  ensureDeliveryAssetMapping,
  filterUuids,
  getShareLinkContext,
  getUserFromBearer,
} from './helpers/access'

export {
  buildBaseHeaders,
  jsonError,
  resolveAllowedOrigin,
  responseHeaders,
  SAFE_ERROR_PATTERNS,
  supabaseRequest,
} from './helpers/http'
export {
  createDownloadToken,
  createPreviewToken,
  createUploadToken,
  getTokenSigningSecret,
  timingSafeEqual,
  verifyDownloadToken,
  verifyPreviewToken,
  verifyUploadToken,
} from './helpers/tokens'
export {
  ensureAdmin,
  ensureAdminAndOwnedDelivery,
  ensureAdminOwnedAsset,
  ensureDeliveryAccess,
  ensureDeliveryAssetMapping,
  filterUuids,
  getShareLinkContext,
  getUserFromBearer,
  isUuid,
} from './helpers/access'

/* ── Constants ───────────────────────────────────────────────────── */

export const adminActivityKinds = new Set<AdminActivityKind>([
  'upload', 'download', 'delete', 'edit', 'create',
])

export const rateWindowMs = 60_000
export const maxUploadBytes = 5 * 1024 * 1024 * 1024
export const uploadUrlExpirySeconds = 900
export const routeRateLimits = new Map<string, { count: number; windowStart: number }>()
export const routeLimits: Record<string, number> = {
  '/api/v1/media/signed-url': 90,
  '/api/v1/request-upload-url': 30,
  '/api/v1/upload/complete': 60,
}

export const MAX_SHORT_TEXT = 255
export const MAX_LONG_TEXT = 5000

/* ── R2 / Signed URLs ────────────────────────────────────────────── */

const toHex = (buffer: ArrayBuffer | ArrayBufferLike | Uint8Array): string => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const sha256Hex = async (value: string): Promise<string> => {
  const data = new TextEncoder().encode(value)
  return toHex(await crypto.subtle.digest('SHA-256', data))
}

const hmacSha256 = async (key: Uint8Array, value: string): Promise<Uint8Array> => {
  const cryptoKey = await crypto.subtle.importKey('raw', key as unknown as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
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
  return { dateStamp: `${yyyy}${mm}${dd}`, amzDate: `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z` }
}

export const buildR2SignedUrl = async (env: Env, method: 'GET' | 'PUT', objectKey: string, expiresInSec: number, mode: Mode) => {
  const now = new Date()
  const { dateStamp, amzDate } = asUtcDateParts(now)
  const region = 'auto'
  const service = 's3'
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  const encodedKey = objectKey.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  const canonicalUri = `/${env.R2_BUCKET}/${encodedKey}`
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const baseParams = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${env.R2_ACCESS_KEY_ID}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresInSec),
    'X-Amz-SignedHeaders': 'host',
  })
  if (mode === 'download' && method === 'GET') baseParams.set('response-content-disposition', 'attachment')
  const canonicalQuery = [...baseParams.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  const canonicalRequest = [method, canonicalUri, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n')
  const canonicalRequestHash = await sha256Hex(canonicalRequest)
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, canonicalRequestHash].join('\n')
  const kDate = await hmacSha256(new TextEncoder().encode(`AWS4${env.R2_SECRET_ACCESS_KEY}`), dateStamp)
  const kRegion = await hmacSha256(kDate, region)
  const kService = await hmacSha256(kRegion, service)
  const kSigning = await hmacSha256(kService, 'aws4_request')
  const signature = toHex(await hmacSha256(kSigning, stringToSign).then((x) => x.buffer))
  const finalParams = `${canonicalQuery}&${encodeURIComponent('X-Amz-Signature')}=${signature}`
  return `https://${host}${canonicalUri}?${finalParams}`
}

/* ── Preview URL builders ────────────────────────────────────────── */

export const resolvePreviewAccessContext = async (env: Env, authHeader: string | undefined, shareToken?: string): Promise<PreviewAccessContext> => {
  if (shareToken) {
    const context = await getShareLinkContext(env, shareToken)
    if (!context) throw new Error('Invalid share token')
    if (new Date(context.link.expires_at).getTime() <= Date.now()) throw new Error('Share link expired')
    return { kind: 'share', context }
  }
  const user = await getUserFromBearer(env, authHeader)
  return { kind: 'user', user }
}

export const buildPreviewUrlForAsset = async (env: Env, origin: string, access: PreviewAccessContext, assetId: string, variant: MediaVariant = 'preview') => {
  const assets = await supabaseRequest<Array<{ id: string; delivery_id: string | null; r2_object_key: string; mime_type: string }>>(env, `assets?id=eq.${encodeURIComponent(assetId)}&select=id,delivery_id,r2_object_key,mime_type&limit=1`)
  const asset = assets[0]
  if (!asset) throw new Error('Asset not found')
  if (asset.r2_object_key.startsWith('pending/')) throw new Error('This file was never uploaded to storage. Re-upload it from Admin Upload.')
  const deliveryAssetRows = await supabaseRequest<Array<{ delivery_id: string }>>(env, `delivery_assets?asset_id=eq.${encodeURIComponent(assetId)}&select=delivery_id&limit=1`)
  const deliveryAsset = deliveryAssetRows[0]
  const deliveryId = asset.delivery_id ?? deliveryAsset?.delivery_id
  if (!deliveryId || !deliveryAsset) throw new Error('Asset delivery mapping missing')
  if (access.kind === 'share') {
    if (access.context.link.delivery_id !== deliveryId) throw new Error('Asset not in shared delivery')
    if (access.context.link.scope_type === 'selected' && !access.context.selectedAssetIds.has(asset.id)) throw new Error('Asset not in shared selection')
  } else {
    await ensureDeliveryAccess(env, access.user, deliveryId, 'view')
  }
  const token = await createPreviewToken(getTokenSigningSecret(env), { v: 1, assetId: asset.id, deliveryId, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() })
  return { assetId: asset.id, url: `${origin}/api/v1/media/${variant}?token=${encodeURIComponent(token)}` }
}

export const buildPreviewUrlBatch = async (env: Env, origin: string, access: PreviewAccessContext, assetIds: string[], variant: MediaVariant = 'preview') => {
  if (assetIds.length === 0) return {}
  const assetFilter = assetIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',')
  const [allAssets, allDeliveryAssets] = await Promise.all([
    supabaseRequest<Array<{ id: string; delivery_id: string | null; r2_object_key: string; mime_type: string }>>(env, `assets?or=(${assetFilter})&select=id,delivery_id,r2_object_key,mime_type`),
    supabaseRequest<Array<{ asset_id: string; delivery_id: string }>>(env, `delivery_assets?or=(${assetIds.map((id) => `asset_id.eq.${encodeURIComponent(id)}`).join(',')})&select=asset_id,delivery_id`),
  ])
  const assetMap = new Map(allAssets.map((a) => [a.id, a]))
  const deliveryAssetMap = new Map(allDeliveryAssets.map((da) => [da.asset_id, da.delivery_id]))
  const results: Record<string, string> = {}
  await Promise.allSettled(assetIds.map(async (assetId) => {
    const asset = assetMap.get(assetId)
    if (!asset || asset.r2_object_key.startsWith('pending/')) return
    const deliveryId = asset.delivery_id ?? deliveryAssetMap.get(assetId)
    if (!deliveryId) return
    if (access.kind === 'share') {
      if (access.context.link.delivery_id !== deliveryId) return
      if (access.context.link.scope_type === 'selected' && !access.context.selectedAssetIds.has(asset.id)) return
    } else {
      try { await ensureDeliveryAccess(env, access.user, deliveryId, 'view') } catch { return }
    }
    const token = await createPreviewToken(getTokenSigningSecret(env), { v: 1, assetId: asset.id, deliveryId, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() })
    results[assetId] = `${origin}/api/v1/media/${variant}?token=${encodeURIComponent(token)}`
  }))
  return results
}

/* ── Delivery / Share helpers ────────────────────────────────────── */

export const getDeliveryAssetRules = async (env: Env, deliveryId: string): Promise<Map<string, DeliveryAssetRule>> => {
  const rows = await supabaseRequest<Array<{ asset_id: string }>>(env, `delivery_assets?delivery_id=eq.${encodeURIComponent(deliveryId)}&select=asset_id`)
  return new Map(rows.map((row) => [row.asset_id, { assetId: row.asset_id, canView: true, canDownload: true }]))
}
/* ── Admin Activity ──────────────────────────────────────────────── */

export const normalizeActivityMetadata = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export const insertAdminActivity = async (env: Env, payload: {
  ownerUserId: string; actorProfileId?: string | null; kind: AdminActivityKind; title: string; detail: string
  clientId?: string | null; projectId?: string | null; assetId?: string | null; metadata?: unknown
}) => {
  const rows = await supabaseRequest<Array<AdminActivityRow>>(env, 'admin_activity_events?select=id,owner_user_id,actor_profile_id,kind,title,detail,client_id,project_id,asset_id,metadata,created_at', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      owner_user_id: payload.ownerUserId, actor_profile_id: payload.actorProfileId ?? payload.ownerUserId,
      kind: payload.kind, title: payload.title, detail: payload.detail,
      client_id: payload.clientId ?? null, project_id: payload.projectId ?? null, asset_id: payload.assetId ?? null,
      metadata: normalizeActivityMetadata(payload.metadata),
    }),
  }, true)
  return rows[0] ?? null
}

export const serializeAdminActivity = (row: AdminActivityRow) => ({
  id: row.id, kind: row.kind, title: row.title, detail: row.detail,
  clientId: row.client_id, projectId: row.project_id, assetId: row.asset_id,
  metadata: row.metadata ?? {}, createdAt: row.created_at,
})

/* ── Download / Storage helpers ──────────────────────────────────── */

export const logDownloadEvent = async (env: Env, payload: { deliveryId: string; assetId: string; requesterProfileId: string | null; ipHash: string | null; userAgent: string | null }) => {
  await supabaseRequest(env, 'download_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ delivery_id: payload.deliveryId, asset_id: payload.assetId, requester_profile_id: payload.requesterProfileId, ip_hash: payload.ipHash, user_agent: payload.userAgent }),
  }, true)
}

export const deleteStoredAssets = async (env: Env, objectKeys: string[]) => {
  const uniqueKeys = [...new Set(objectKeys)].filter((key) => key && !key.startsWith('pending/'))
  await Promise.all(uniqueKeys.map((key) => env.R2_MEDIA_BUCKET.delete(key)))
}

/* ── File name helpers ───────────────────────────────────────────── */

export const getDisplayFileName = (value: string) => {
  const cleaned = value.trim().replace(/\/+$/, '')
  const segments = cleaned.split('/').filter(Boolean)
  return segments[segments.length - 1] || cleaned
}

export const sanitizeArchiveEntryName = (value: string) => {
  const baseName = getDisplayFileName(value).replace(/[\0\\/:*?"<>|]/g, '_').trim()
  return baseName || 'file'
}

const uniquifyArchiveEntryName = (filename: string, seen: Set<string>) => {
  const initialName = sanitizeArchiveEntryName(filename)
  if (!seen.has(initialName)) { seen.add(initialName); return initialName }
  const dotIndex = initialName.lastIndexOf('.')
  const baseName = dotIndex > 0 ? initialName.slice(0, dotIndex) : initialName
  const extension = dotIndex > 0 ? initialName.slice(dotIndex) : ''
  let suffix = 2
  while (true) {
    const candidate = `${baseName} (${suffix})${extension}`
    if (!seen.has(candidate)) { seen.add(candidate); return candidate }
    suffix += 1
  }
}

export const streamZipResponse = async (c: Context<{ Bindings: Env }>, entries: Array<{ filename: string; r2_object_key: string }>, archiveName: string) => {
  const { Zip: ZipCtor, ZipPassThrough: ZipPassThroughCtor } = await import('fflate')
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const zip = new ZipCtor((error, chunk, final) => {
        if (error) { controller.error(error); return }
        if (chunk) controller.enqueue(chunk)
        if (final) controller.close()
      })
      void (async () => {
        try {
          const seenNames = new Set<string>()
          /* Prefetch next object while streaming the current one.
             We kick off GET N+1 as soon as we start streaming N. */
          const PREFETCH_AHEAD = 2
          const pending: Array<Promise<R2ObjectBody | null>> = []
          const getObject = (key: string) =>
            c.env.R2_MEDIA_BUCKET.get(key) as Promise<R2ObjectBody | null>

          // seed the prefetch window
          for (let i = 0; i < Math.min(PREFETCH_AHEAD, entries.length); i++) {
            pending.push(getObject(entries[i].r2_object_key))
          }

          for (let i = 0; i < entries.length; i++) {
            const entry = entries[i]
            const object = await pending.shift()
            if (!object?.body) throw new Error(`File missing in storage for ${entry.filename}. Re-upload required.`)

            // kick off the next prefetch as soon as we start streaming current
            const nextIdx = i + PREFETCH_AHEAD
            if (nextIdx < entries.length) {
              pending.push(getObject(entries[nextIdx].r2_object_key))
            }

            const archiveEntry = new ZipPassThroughCtor(uniquifyArchiveEntryName(entry.filename, seenNames))
            zip.add(archiveEntry)
            const reader = object.body.getReader()
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              if (value) archiveEntry.push(value, false)
            }
            archiveEntry.push(new Uint8Array(0), true)
          }
          zip.end()
        } catch (error) { controller.error(error instanceof Error ? error : new Error('Failed to build archive')) }
      })()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { ...responseHeaders(c), 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${sanitizeArchiveEntryName(archiveName)}"`, 'cache-control': 'no-store' },
  })
}

/* ── Input validation ────────────────────────────────────────────── */

export const parseNullableText = (value: unknown, maxLength = MAX_SHORT_TEXT): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().slice(0, maxLength)
  return trimmed.length > 0 ? trimmed : null
}

export const sanitizeFileName = (fileName: string): string => fileName.replace(/[^a-zA-Z0-9._-]/g, '_')

export const parseProjectStatus = (value: unknown): 'draft' | 'active' | 'completed' | 'archived' | undefined => {
  if (value === 'draft' || value === 'active' || value === 'completed' || value === 'archived') return value
  return undefined
}
