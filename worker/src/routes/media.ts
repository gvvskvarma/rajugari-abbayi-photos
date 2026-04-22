import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Env, Mode, MediaVariant } from '../types'
import {
  responseHeaders, jsonError,
  supabaseRequest, getUserFromBearer, ensureDeliveryAccess,
  createPreviewToken, verifyPreviewToken, createDownloadToken, verifyDownloadToken,
  buildR2SignedUrl, resolvePreviewAccessContext, buildPreviewUrlForAsset, buildPreviewUrlBatch,
  getShareLinkContext, getTokenSigningSecret,
  logDownloadEvent, sha256Hex,
} from '../lib'

const media = new Hono<{ Bindings: Env }>()

media.post('/signed-url', async (c) => {
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
        return buildDownloadTokenResponse(c, asset, deliveryId)
      }

      /* Share-link view: route through internal preview-token proxy rather
         than exposing a raw R2 presigned URL. Raw URLs leak the R2 host,
         bucket, object key and a 5-min-valid signature that could be
         re-shared externally, bypassing scope enforcement. */
      const origin = new URL(c.req.url).origin
      const previewToken = await createPreviewToken(getTokenSigningSecret(c.env), {
        v: 1,
        assetId: asset.id,
        deliveryId,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      })
      const signedUrl = `${origin}/api/v1/media/preview?token=${encodeURIComponent(previewToken)}`
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
      return buildDownloadTokenResponse(c, asset, deliveryId)
    }

    const signedUrl = await buildR2SignedUrl(c.env, 'GET', asset.r2_object_key, 300, mode)
    return c.json({ signedUrl, expiresInSeconds: 300, mode }, 200, responseHeaders(c))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Signed URL request failed', 400)
  }
})

/** Shared helper to build a download token response */
async function buildDownloadTokenResponse(
  c: Context<{ Bindings: Env }>,
  asset: { id: string; r2_object_key: string; mime_type: string; filename: string },
  deliveryId: string,
) {
  const origin = new URL(c.req.url).origin
  const downloadToken = await createDownloadToken(getTokenSigningSecret(c.env), {
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
  return c.json({ signedUrl, expiresInSeconds: 300, mode: 'download' }, 200, responseHeaders(c))
}

media.post('/preview-url', async (c) => {
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

media.post('/preview-url-batch', async (c) => {
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

media.get('/preview', async (c) => {
  try {
    const token = c.req.query('token')
    if (!token) return jsonError('token is required', 400)

    const payload = await verifyPreviewToken(getTokenSigningSecret(c.env), token)
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

media.get('/download', async (c) => {
  try {
    const token = c.req.query('token')
    if (!token) return jsonError('token is required', 400)

    const payload = await verifyDownloadToken(getTokenSigningSecret(c.env), token)

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

media.get('/thumb', async (c) => {
  try {
    const token = c.req.query('token')
    if (!token) return jsonError('token is required', 400)

    const payload = await verifyPreviewToken(getTokenSigningSecret(c.env), token)
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

export { media }
