import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Env } from '../types'
import {
  maxUploadBytes, uploadUrlExpirySeconds,
  responseHeaders, jsonError,
  supabaseRequest, getUserFromBearer,
  ensureAdminAndOwnedDelivery,
  createUploadToken, verifyUploadToken,
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

upload.post('/request', handleRequestUploadUrl)

export { handleRequestUploadUrl }

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

export { upload }
