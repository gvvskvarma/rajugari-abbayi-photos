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
  ensureDeliveryAccess,
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
  createZipDownloadToken,
  verifyZipDownloadToken,
  createProjectZipDownloadToken,
  verifyProjectZipDownloadToken,
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
export {
  renderDeliveryReadyEmail,
  sendDeliveryReady,
  renderExpiryWarningEmail,
  sendExpiryWarning,
} from './helpers/email'
export type {
  DeliveryReadyEmailInput,
  ExpiryWarningEmailInput,
  EmailSendResult,
} from './helpers/email'
export { ensureAuthUser, generateSignInLink } from './helpers/magic-link'

/* ── Constants ───────────────────────────────────────────────────── */

export const adminActivityKinds = new Set<AdminActivityKind>([
  'upload', 'download', 'delete', 'edit', 'create',
])

export const rateWindowMs = 60_000
export const maxUploadBytes = 5 * 1024 * 1024 * 1024
export const uploadUrlExpirySeconds = 900
export const routeRateLimits = new Map<string, { count: number; windowStart: number }>()
/* Per-IP per-minute caps. The upload endpoints need high ceilings: a single
   photo delivery is routinely 100s of files, and each file makes one
   request-upload-url + one upload/complete call. The previous 30/60 caps
   tripped a 429 mid-upload on any delivery larger than ~30 photos. These
   routes are admin-auth-gated, so a generous limit is safe — it bounds
   accidental runaway loops, not legitimate bulk uploads. media/signed-url
   is bumped too since a large gallery preview-loads many thumbnails. */
export const routeLimits: Record<string, number> = {
  '/api/v1/media/signed-url': 600,
  '/api/v1/request-upload-url': 600,
  '/api/v1/upload/complete': 600,
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
  /* Dedupe case-INSENSITIVELY. Clients extract on macOS/Windows, whose default
     filesystems are case-insensitive, so "RGA1.JPG" and "RGA1.jpg" would land
     on the same path and one would silently overwrite the other (the archive
     looks complete in `unzip -t` but loses files on extract). Renaming the
     collision keeps every file. */
  const initialName = sanitizeArchiveEntryName(filename)
  if (!seen.has(initialName.toLowerCase())) { seen.add(initialName.toLowerCase()); return initialName }
  const dotIndex = initialName.lastIndexOf('.')
  const baseName = dotIndex > 0 ? initialName.slice(0, dotIndex) : initialName
  const extension = dotIndex > 0 ? initialName.slice(dotIndex) : ''
  let suffix = 2
  while (true) {
    const candidate = `${baseName} (${suffix})${extension}`
    if (!seen.has(candidate.toLowerCase())) { seen.add(candidate.toLowerCase()); return candidate }
    suffix += 1
  }
}

/* CRC32 (IEEE) lookup table — every ZIP entry needs a checksum. */
const ZIP_CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()
const crc32 = (buf: Uint8Array): number => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = ZIP_CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const dosDateTime = (d: Date) => {
  const time = ((d.getUTCHours() & 0x1f) << 11) | ((d.getUTCMinutes() & 0x3f) << 5) | ((d.getUTCSeconds() >> 1) & 0x1f)
  const year = d.getUTCFullYear()
  const date = year < 1980 ? (1 << 5) | 1 : (((year - 1980) & 0x7f) << 9) | (((d.getUTCMonth() + 1) & 0x0f) << 5) | (d.getUTCDate() & 0x1f)
  return { time: time & 0xffff, date: date & 0xffff }
}
const U32_MAX = 0xffffffff

/**
 * Streams a STORED (uncompressed) ZIP of the given R2 objects, hand-written to
 * be maximally compatible with STRICT unzippers — macOS Archive Utility /
 * `ditto` and the iPhone Files app — at any total size.
 *
 * Two earlier approaches both produced files those strict tools rejected:
 *  - fflate only triggered ZIP64 on per-FILE size, so a many-small-photos
 *    delivery whose TOTAL crossed 4 GB got malformed central-directory offsets
 *    (Archive Utility "Error 79"; `unzip` reported bad offsets past 4 GB).
 *  - client-zip emits correct ZIP64 but ALWAYS uses data descriptors (CRC
 *    written AFTER each file), and macOS's engine rejects the ZIP64 +
 *    data-descriptor combination (it extracted only part of the archive).
 *
 * So we buffer ONE file at a time (photos are tens of MB), which lets us put
 * the CRC and sizes in the local header — NO data descriptor — and we emit
 * ZIP64 extra fields / ZIP64 EOCD strictly per APPNOTE, only where an offset
 * or entry count actually overflows 32 bits. This is the same byte layout
 * Windows Explorer / macOS Finder / Info-ZIP produce, which every native
 * unzipper accepts. Verified end-to-end against `ditto` and `unzip` at >4 GB.
 *
 * Output is pull-based, so worker memory stays at ~one file plus a small queue
 * no matter how large the archive is; the per-byte CRC32 CPU cost is covered
 * by the raised cpu_ms limit (see wrangler.toml).
 *
 * NOTE: assumes each INDIVIDUAL file is < 4 GB (always true for photos). A
 * single file >= 4 GB would additionally need ZIP64 fields in its local header.
 */
export const streamZipResponse = async (c: Context<{ Bindings: Env }>, entries: Array<{ filename: string; r2_object_key: string }>, archiveName: string) => {
  const encoder = new TextEncoder()
  const seenNames = new Set<string>()
  const named = entries.map((entry) => ({ ...entry, nameBytes: encoder.encode(uniquifyArchiveEntryName(entry.filename, seenNames)) }))

  const zipBytes = async function* (): AsyncGenerator<Uint8Array> {
    let offset = 0
    const central: Array<{ nameBytes: Uint8Array; crc: number; size: number; localOffset: number; time: number; date: number }> = []

    for (const entry of named) {
      const object = (await c.env.R2_MEDIA_BUCKET.get(entry.r2_object_key)) as R2ObjectBody | null
      if (!object?.body) throw new Error(`File missing in storage for ${entry.filename}. Re-upload required.`)
      const data = new Uint8Array(await object.arrayBuffer()) // one file at a time (photos are tens of MB)
      const crc = crc32(data)
      const size = data.length
      const localOffset = offset
      const { time, date } = dosDateTime(object.uploaded ?? new Date(0))

      const lh = new DataView(new ArrayBuffer(30))
      lh.setUint32(0, 0x04034b50, true) // local file header signature
      lh.setUint16(4, 45, true) // version needed (4.5)
      lh.setUint16(6, 0x0800, true) // flags: UTF-8 names, NO data descriptor
      lh.setUint16(8, 0, true) // method: stored
      lh.setUint16(10, time, true)
      lh.setUint16(12, date, true)
      lh.setUint32(14, crc, true)
      lh.setUint32(18, size, true) // compressed size (file < 4 GB)
      lh.setUint32(22, size, true) // uncompressed size
      lh.setUint16(26, entry.nameBytes.length, true)
      lh.setUint16(28, 0, true) // extra length (local) = 0
      yield new Uint8Array(lh.buffer); offset += 30
      yield entry.nameBytes; offset += entry.nameBytes.length
      yield data; offset += size

      central.push({ nameBytes: entry.nameBytes, crc, size, localOffset, time, date })
    }

    const cdStart = offset
    for (const e of central) {
      const offNeedsZip64 = e.localOffset >= U32_MAX
      let extra: Uint8Array | null = null
      if (offNeedsZip64) {
        const z = new DataView(new ArrayBuffer(12))
        z.setUint16(0, 0x0001, true) // ZIP64 extra tag
        z.setUint16(2, 8, true) // 8 bytes follow (just the 64-bit local-header offset)
        z.setBigUint64(4, BigInt(e.localOffset), true)
        extra = new Uint8Array(z.buffer)
      }

      const ch = new DataView(new ArrayBuffer(46))
      ch.setUint32(0, 0x02014b50, true) // central directory header signature
      ch.setUint16(4, 45, true) // version made by
      ch.setUint16(6, 45, true) // version needed
      ch.setUint16(8, 0x0800, true) // flags
      ch.setUint16(10, 0, true) // method: stored
      ch.setUint16(12, e.time, true)
      ch.setUint16(14, e.date, true)
      ch.setUint32(16, e.crc, true)
      ch.setUint32(20, e.size, true) // compressed size
      ch.setUint32(24, e.size, true) // uncompressed size
      ch.setUint16(28, e.nameBytes.length, true)
      ch.setUint16(30, extra ? extra.length : 0, true)
      ch.setUint16(32, 0, true) // comment length
      ch.setUint16(34, 0, true) // disk number start
      ch.setUint16(36, 0, true) // internal attrs
      ch.setUint32(38, 0, true) // external attrs
      ch.setUint32(42, offNeedsZip64 ? U32_MAX : e.localOffset, true)
      yield new Uint8Array(ch.buffer); offset += 46
      yield e.nameBytes; offset += e.nameBytes.length
      if (extra) { yield extra; offset += extra.length }
    }
    const cdSize = offset - cdStart
    const count = central.length

    if (count > 0xffff || cdStart >= U32_MAX || cdSize >= U32_MAX) {
      const z64 = new DataView(new ArrayBuffer(56))
      z64.setUint32(0, 0x06064b50, true) // ZIP64 EOCD record signature
      z64.setBigUint64(4, BigInt(44), true) // size of remaining record
      z64.setUint16(12, 45, true)
      z64.setUint16(14, 45, true)
      z64.setUint32(16, 0, true) // disk number
      z64.setUint32(20, 0, true) // disk with CD start
      z64.setBigUint64(24, BigInt(count), true)
      z64.setBigUint64(32, BigInt(count), true)
      z64.setBigUint64(40, BigInt(cdSize), true)
      z64.setBigUint64(48, BigInt(cdStart), true)
      const z64Offset = offset
      yield new Uint8Array(z64.buffer); offset += 56

      const loc = new DataView(new ArrayBuffer(20))
      loc.setUint32(0, 0x07064b50, true) // ZIP64 EOCD locator signature
      loc.setUint32(4, 0, true) // disk with ZIP64 EOCD
      loc.setBigUint64(8, BigInt(z64Offset), true)
      loc.setUint32(16, 1, true) // total disks
      yield new Uint8Array(loc.buffer); offset += 20
    }

    const eocd = new DataView(new ArrayBuffer(22))
    eocd.setUint32(0, 0x06054b50, true) // EOCD signature
    eocd.setUint16(4, 0, true)
    eocd.setUint16(6, 0, true)
    eocd.setUint16(8, count > 0xffff ? 0xffff : count, true)
    eocd.setUint16(10, count > 0xffff ? 0xffff : count, true)
    eocd.setUint32(12, cdSize >= U32_MAX ? U32_MAX : cdSize, true)
    eocd.setUint32(16, cdStart >= U32_MAX ? U32_MAX : cdStart, true)
    eocd.setUint16(20, 0, true) // comment length
    yield new Uint8Array(eocd.buffer)
  }

  const gen = zipBytes()
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await gen.next()
        if (done) controller.close()
        else if (value) controller.enqueue(value)
      } catch (error) {
        controller.error(error instanceof Error ? error : new Error('Failed to build archive'))
      }
    },
    cancel() { void gen.return?.(undefined) },
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
