import { Hono } from 'hono'
import type { Env, ShareLinkScope } from '../types'
import {
  responseHeaders, jsonError,
  supabaseRequest, getUserFromBearer, ensureDeliveryAccess,
  getDeliveryAssetRules, getShareLinkContext,
  logDownloadEvent, streamZipResponse, sha256Hex,
  filterUuids, sanitizeArchiveEntryName,
  getTokenSigningSecret, createZipDownloadToken, verifyZipDownloadToken,
} from '../lib'

const delivery = new Hono<{ Bindings: Env }>()

/* ── Delivery Gallery ──────────────────────────────────────────── */

delivery.get('/:deliveryId/gallery', async (c) => {
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

/* ── Delivery Download ─────────────────────────────────────────── */

delivery.post('/:deliveryId/download', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    const deliveryId = c.req.param('deliveryId')
    if (!deliveryId) return jsonError('deliveryId is required', 400)

    await ensureDeliveryAccess(c.env, user, deliveryId, 'download')

    const body = await c.req.json<{ assetIds?: string[] }>()
    /* Validate UUIDs — these get interpolated into PostgREST or=(...) filters
       below, where unescaped commas/parens could alter filter semantics. */
    const requestedIds = body.assetIds && body.assetIds.length > 0
      ? [...new Set(filterUuids(body.assetIds))]
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
    /* Parallel log inserts — was serial (N round trips added latency before
       zip stream could start for large deliveries). */
    await Promise.all(
      uploadedAssets.map((asset) =>
        logDownloadEvent(c.env, {
          deliveryId,
          assetId: asset.id,
          requesterProfileId: user.id,
          ipHash,
          userAgent: c.req.header('User-Agent') ?? null,
        })
      )
    )

    const archiveName = `photos-${deliveryId.slice(0, 8)}.zip`
    return streamZipResponse(c, uploadedAssets, archiveName)
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Download failed', 400)
  }
})

/* ── Native ZIP download (token-authed GET) ──────────────────────────
   The client POSTs here (with its bearer token) to mint a short-lived
   signed download token, then navigates the browser to the GET endpoint
   below. Native navigation can't carry an auth header, so the signed token
   IS the auth. This lets the browser stream the zip straight to disk — no
   in-memory buffering — which is the only way multi-GB downloads work on
   iPhone Safari. */
delivery.post('/:deliveryId/download-token', async (c) => {
  try {
    const user = await getUserFromBearer(c.env, c.req.header('authorization'))
    const deliveryId = c.req.param('deliveryId')
    if (!deliveryId) return jsonError('deliveryId is required', 400)
    await ensureDeliveryAccess(c.env, user, deliveryId, 'download')

    const body = await c.req.json<{ folder?: string | null; filename?: string }>().catch(() => ({} as { folder?: string | null; filename?: string }))
    const folder = typeof body.folder === 'string' && body.folder.trim() ? body.folder.trim().slice(0, 120) : null
    const rawName = typeof body.filename === 'string' && body.filename.trim() ? body.filename.trim() : `photos-${deliveryId.slice(0, 8)}`
    const filename = `${sanitizeArchiveEntryName(rawName).replace(/\.zip$/i, '')}.zip`

    const now = Date.now()
    const token = await createZipDownloadToken(getTokenSigningSecret(c.env), {
      v: 1,
      deliveryId,
      folder,
      filename,
      issuedAt: new Date(now).toISOString(),
      /* 15 min is plenty to start the download; the stream itself can run
         much longer once it's begun. */
      expiresAt: new Date(now + 15 * 60 * 1000).toISOString(),
    })

    return c.json({ token, path: `/api/v1/deliveries/${deliveryId}/download?token=${encodeURIComponent(token)}` }, 200, responseHeaders(c))
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Could not prepare download', 400)
  }
})

delivery.get('/:deliveryId/download', async (c) => {
  try {
    const deliveryId = c.req.param('deliveryId')
    const token = c.req.query('token')
    if (!deliveryId || !token) return jsonError('token is required', 400)

    const payload = await verifyZipDownloadToken(getTokenSigningSecret(c.env), token)
    if (payload.deliveryId !== deliveryId) return jsonError('Token does not match this delivery', 403)

    /* Re-check the delivery hasn't expired/been purged since the token was
       minted (retention lifecycle). */
    const deliveryState = await supabaseRequest<Array<{ expired_at: string | null; purged_at: string | null }>>(
      c.env,
      `deliveries?id=eq.${encodeURIComponent(deliveryId)}&select=expired_at,purged_at&limit=1`
    )
    if (deliveryState[0]?.purged_at) return jsonError('These files have been removed', 410)
    if (deliveryState[0]?.expired_at) return jsonError('This delivery has expired', 410)

    const assetRules = await getDeliveryAssetRules(c.env, deliveryId)
    const downloadableIds = [...assetRules.values()].filter((r) => r.canDownload).map((r) => r.assetId)
    if (downloadableIds.length === 0) return jsonError('No downloadable assets', 404)

    const assetFilter = downloadableIds.map((id) => `id.eq.${id}`).join(',')
    let assets = await supabaseRequest<
      Array<{ id: string; filename: string; r2_object_key: string; folder: string | null }>
    >(
      c.env,
      `assets?or=(${assetFilter})&select=id,filename,r2_object_key,folder&order=created_at.asc`
    )
    assets = assets.filter((a) => !a.r2_object_key.startsWith('pending/'))
    if (payload.folder) assets = assets.filter((a) => (a.folder ?? '') === payload.folder)
    if (assets.length === 0) return jsonError('No files available for download', 404)

    return streamZipResponse(c, assets, payload.filename)
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Download failed', 400)
  }
})

export { delivery }

/* ── Share Links (mounted separately at /api/v1/share-links) ─── */

const shareLinks = new Hono<{ Bindings: Env }>()

shareLinks.get('/:token/gallery', async (c) => {
  try {
    const token = c.req.param('token')
    if (!token) return jsonError('token is required', 400)

    const context = await getShareLinkContext(c.env, token)
    if (!context) return jsonError('Invalid share token', 403)
    if (new Date(context.link.expires_at).getTime() <= Date.now()) return jsonError('Share link expired', 403)

    /* Retention gate: even a still-valid share link must stop working once
       the underlying delivery is soft-deleted or its files are purged. */
    const deliveryState = await supabaseRequest<Array<{ expired_at: string | null; purged_at: string | null }>>(
      c.env,
      `deliveries?id=eq.${encodeURIComponent(context.link.delivery_id)}&select=expired_at,purged_at&limit=1`
    )
    if (deliveryState[0]?.purged_at) return jsonError('These files have been removed', 410)
    if (deliveryState[0]?.expired_at) return jsonError('This delivery has expired', 410)

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
            folder: string | null
          }>
        >(
          c.env,
          `assets?or=(${visibleAssetIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',')})&select=id,delivery_id,filename,mime_type,bytes,r2_object_key,created_at,folder&order=created_at.desc`
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

shareLinks.post('/', async (c) => {
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

    /* Validate UUIDs — interpolated into PostgREST or=(...) filters below */
    const assetIds = [...new Set(filterUuids((body.assetIds ?? []).map((id) => (typeof id === 'string' ? id.trim() : id))))]
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

    /* Default 7-day share window (was 30). Cap it at the delivery's own
       retention cutoff — a share link must never outlive the files it
       points at, or clients hit a dead link after the lifecycle purge. */
    const days = Math.min(7, Math.max(1, body.expiresInDays ?? 7))
    let expiresMs = Date.now() + days * 24 * 60 * 60 * 1000
    const deliveryRetention = await supabaseRequest<Array<{ expires_at: string | null }>>(
      c.env,
      `deliveries?id=eq.${encodeURIComponent(body.deliveryId)}&select=expires_at&limit=1`
    )
    const retentionMs = deliveryRetention[0]?.expires_at
      ? new Date(deliveryRetention[0].expires_at).getTime()
      : null
    if (retentionMs && retentionMs < expiresMs) expiresMs = retentionMs
    const expiresAt = new Date(expiresMs).toISOString()
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
        url: `${c.env.APP_ORIGIN}/share/${shareLink.token ?? token}`,
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

export { shareLinks }
