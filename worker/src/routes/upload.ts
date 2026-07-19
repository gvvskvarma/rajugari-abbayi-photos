import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Env } from '../types'
import {
  maxUploadBytes, uploadUrlExpirySeconds,
  responseHeaders, jsonError,
  supabaseRequest, getUserFromBearer,
  ensureAdminAndOwnedDelivery, ensureDeliveryAssetMapping,
  createUploadToken, verifyUploadToken, getTokenSigningSecret,
  buildR2SignedUrl, sanitizeFileName,
} from '../lib'

const upload = new Hono<{ Bindings: Env }>()

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
    const presignedUrl = await buildR2SignedUrl(c.env, 'PUT', objectKey, uploadUrlExpirySeconds, 'view')
    const signedUploadToken = await createUploadToken(getTokenSigningSecret(c.env), {
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

    /* Primary upload target is the worker itself (PUT /upload/direct), NOT the
       raw R2 host. Ad-block/privacy filter lists block r2.cloudflarestorage.com
       (the domain is abused by malware campaigns), which surfaced as
       "Failed to fetch" on every upload for admins running a blocker — while
       our own API domain sails through. The raw presigned URL is kept as a
       fallback for very large files, since requests proxied through the worker
       are subject to Cloudflare's ~100MB request-body cap. */
    const proxyUploadUrl = `${new URL(c.req.url).origin}/api/v1/upload/direct?token=${encodeURIComponent(signedUploadToken)}`

    return c.json(
      {
        objectKey,
        uploadToken: signedUploadToken,
        uploadUrl: proxyUploadUrl,
        fallbackUploadUrl: presignedUrl,
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

upload.post('/request', handleRequestUploadUrl)

export { handleRequestUploadUrl }

/* Proxied upload: the browser PUTs the file body to our own API domain, which
   ad-block filter lists never block — unlike the raw r2.cloudflarestorage.com
   host (abused by malware, so blockers kill it and every upload "Failed to
   fetch"). Auth is the HMAC-signed upload token minted by /request; the object
   key, content type, and expected size all come from the token, never the
   client, so this grants exactly what the presigned URL granted. */
upload.put('/direct', async (c) => {
  try {
    const token = c.req.query('token')
    if (!token) return jsonError('token is required', 400)
    const session = await verifyUploadToken(getTokenSigningSecret(c.env), token)

    const contentLengthHeader = c.req.header('content-length')
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : null
    if (contentLength !== null && contentLength > maxUploadBytes) {
      return jsonError('File size must be between 1 byte and 5GB', 413)
    }
    if (
      contentLength !== null &&
      contentLength > 0 &&
      Math.abs(session.expectedBytes - contentLength) > Math.max(1024, session.expectedBytes * 0.02)
    ) {
      return jsonError('Uploaded byte count does not match the requested file size', 400)
    }

    if (contentLength !== null && contentLength > 0 && c.req.raw.body) {
      /* Streamed straight into R2 — the incoming request's known length lets
         the binding accept the stream, so worker memory stays flat. */
      await c.env.R2_MEDIA_BUCKET.put(session.objectKey, c.req.raw.body, {
        httpMetadata: { contentType: session.mimeType },
      })
    } else {
      /* No usable length on the stream (rare) — buffer, but only within a
         bound that keeps the worker well under its memory limit. */
      if (session.expectedBytes > 95 * 1024 * 1024) {
        return jsonError('Upload stream is missing a length and is too large to buffer', 411)
      }
      const bytes = await c.req.arrayBuffer()
      if (bytes.byteLength < 1) return jsonError('File body is required', 400)
      await c.env.R2_MEDIA_BUCKET.put(session.objectKey, bytes, {
        httpMetadata: { contentType: session.mimeType },
      })
    }

    return c.json({ ok: true, objectKey: session.objectKey }, 200, responseHeaders(c))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Upload failed', 400)
  }
})

/* ── Multipart proxy upload ──────────────────────────────────────────
   For files past Cloudflare's per-request body cap, the client slices the
   file into ~90MB parts and PUTs each part here; R2 reassembles them
   server-side. Every request stays on our API domain (never blocked by
   ad-block lists) and under the edge cap — so any file size works.
   Auth on every call is the same HMAC-signed upload token from /request;
   the object key + content type come from the token, never the client. */

upload.post('/mp/create', async (c) => {
  try {
    const token = c.req.query('token')
    if (!token) return jsonError('token is required', 400)
    const session = await verifyUploadToken(getTokenSigningSecret(c.env), token)
    const mp = await c.env.R2_MEDIA_BUCKET.createMultipartUpload(session.objectKey, {
      httpMetadata: { contentType: session.mimeType },
    })
    return c.json({ uploadId: mp.uploadId }, 200, responseHeaders(c))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Could not start upload', 400)
  }
})

upload.put('/mp/part', async (c) => {
  try {
    const token = c.req.query('token')
    const uploadId = c.req.query('uploadId')
    const partNumber = Number(c.req.query('part'))
    if (!token || !uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
      return jsonError('token, uploadId, and part (1-10000) are required', 400)
    }
    const session = await verifyUploadToken(getTokenSigningSecret(c.env), token)
    if (!c.req.raw.body) return jsonError('Part body is required', 400)
    const mp = c.env.R2_MEDIA_BUCKET.resumeMultipartUpload(session.objectKey, uploadId)
    /* Streams with the request's known content-length — no buffering. */
    const part = await mp.uploadPart(partNumber, c.req.raw.body)
    return c.json({ partNumber: part.partNumber, etag: part.etag }, 200, responseHeaders(c))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Part upload failed', 400)
  }
})

upload.post('/mp/complete', async (c) => {
  try {
    const token = c.req.query('token')
    if (!token) return jsonError('token is required', 400)
    const session = await verifyUploadToken(getTokenSigningSecret(c.env), token)
    const body = await c.req.json<{ uploadId?: string; parts?: Array<{ partNumber: number; etag: string }> }>().catch(() => ({} as { uploadId?: string; parts?: Array<{ partNumber: number; etag: string }> }))
    if (!body.uploadId || !Array.isArray(body.parts) || body.parts.length === 0) {
      return jsonError('uploadId and parts are required', 400)
    }
    const mp = c.env.R2_MEDIA_BUCKET.resumeMultipartUpload(session.objectKey, body.uploadId)
    await mp.complete(body.parts)
    return c.json({ ok: true, objectKey: session.objectKey }, 200, responseHeaders(c))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Upload finalize failed', 400)
  }
})

upload.post('/complete', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    const body = await c.req.json<{
      deliveryId: string
      objectKey: string
      uploadToken: string
      fileName: string
      mimeType: string
      bytes: number
      folder?: string | null
    }>()

    if (
      !body.deliveryId ||
      !body.objectKey ||
      !body.uploadToken ||
      !body.fileName ||
      !body.mimeType ||
      typeof body.bytes !== 'number' ||
      !Number.isInteger(body.bytes) ||
      body.bytes < 1
    ) {
      return jsonError('deliveryId, objectKey, uploadToken, fileName, mimeType, bytes are required (bytes must be a positive integer)', 400)
    }

    await ensureAdminAndOwnedDelivery(c.env, user, body.deliveryId)

    const session = await verifyUploadToken(getTokenSigningSecret(c.env), body.uploadToken)
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
    /* Folder label for in-gallery grouping. User-controlled, so trim + cap. */
    const folder = typeof body.folder === 'string' && body.folder.trim()
      ? body.folder.trim().slice(0, 120)
      : null

    /* Idempotency: if asset already exists for this object key, ensure
       delivery_assets mapping exists too (heals partial-failure state). */
    const existingAssets = await supabaseRequest<Array<{ id: string }>>(
      c.env,
      `assets?r2_object_key=eq.${encodeURIComponent(body.objectKey)}&select=id&limit=1`
    )
    const existingAssetId = existingAssets[0]?.id
    if (existingAssetId) {
      await ensureDeliveryAssetMapping(c.env, body.deliveryId, existingAssetId)
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
          folder,
          mime_type: body.mimeType,
          bytes: Math.max(1, body.bytes),
          r2_object_key: body.objectKey,
        }),
      },
      true
    )
    const assetId = insertedAssets[0]?.id
    if (!assetId) return jsonError('Asset insert failed', 500)

    /* Compensating cleanup: if delivery_assets insert fails, the asset row
       would be invisible to the gallery forever. Roll back the asset row
       so the next attempt can re-create it cleanly. */
    try {
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
    } catch (mappingError) {
      // Best-effort rollback — if this fails too, manual repair is needed
      try {
        await supabaseRequest(
          c.env,
          `assets?id=eq.${encodeURIComponent(assetId)}`,
          { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
          true
        )
      } catch {
        // swallow — original error is the one to surface
      }
      throw mappingError
    }

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

export { upload }
