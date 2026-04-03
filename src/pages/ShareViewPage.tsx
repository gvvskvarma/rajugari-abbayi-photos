import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { CustomerLightboxState, DeliveryAsset, ShareLinkScope } from '../types'
import { workerRequest } from '../hooks/useApi'
import { getDisplayFileName } from '../lib/upload'
import { getAssetKind, daysRemainingText } from '../lib/helpers'
import { CustomerLightbox } from '../components/CustomerLightbox'
import { SkeletonGrid } from '../components/Skeleton'

export function ShareViewPage() {
  const { token } = useParams<{ token: string }>()

  // ── Share view state ────────────────────────────────────────────────
  const [shareAssets, setShareAssets] = useState<DeliveryAsset[]>([])
  const [shareBusy, setShareBusy] = useState(false)
  const [shareMessage, setShareMessage] = useState('')
  const [shareDeliveryId, setShareDeliveryId] = useState('')
  const [shareExpiresAt, setShareExpiresAt] = useState('')
  const [shareLinkScope, setShareLinkScope] = useState<ShareLinkScope>('all')
  const [sharePageCopyState, setSharePageCopyState] = useState('')
  const [shareAssetPreviewUrls, setShareAssetPreviewUrls] = useState<Record<string, string>>({})
  const [shareAssetThumbnailUrls, setShareAssetThumbnailUrls] = useState<Record<string, string>>({})

  // ── Customer lightbox state ─────────────────────────────────────────
  const [customerLightbox, setCustomerLightbox] = useState<CustomerLightboxState | null>(null)

  // ── Computed values ─────────────────────────────────────────────────
  const customerLightboxAssets = useMemo(() => {
    if (!customerLightbox) return []
    return shareAssets.filter((asset) => asset.mime_type.startsWith('image/'))
  }, [customerLightbox, shareAssets])

  const customerLightboxIndex = useMemo(() => {
    if (!customerLightbox) return -1
    return customerLightboxAssets.findIndex((asset) => asset.id === customerLightbox.assetId)
  }, [customerLightbox, customerLightboxAssets])

  const customerLightboxAsset = customerLightboxIndex >= 0 ? customerLightboxAssets[customerLightboxIndex] : null
  const customerPreviewUrls = shareAssetPreviewUrls
  const customerThumbnailUrls = shareAssetThumbnailUrls

  // ── Share view data loading ─────────────────────────────────────────
  useEffect(() => {
    if (!token) return

    const loadShareView = async () => {
      setShareBusy(true)
      setShareMessage('')
      setShareDeliveryId('')
      setShareExpiresAt('')
      setSharePageCopyState('')
      setShareAssetPreviewUrls({})
      setShareAssetThumbnailUrls({})

      try {
        const payload = await workerRequest<{
          deliveryId: string
          scopeType: ShareLinkScope
          allowDownload: boolean
          expiresAt: string
          assets: DeliveryAsset[]
        }>(`/api/v1/share-links/${encodeURIComponent(token)}/gallery`, '')

        if (new Date(payload.expiresAt).getTime() <= Date.now()) {
          setShareMessage('This share link has expired.')
          setShareAssets([])
          setShareDeliveryId('')
          setShareExpiresAt('')
          setShareAssetPreviewUrls({})
          setShareAssetThumbnailUrls({})
          setShareBusy(false)
          return
        }

        setShareAssets(payload.assets ?? [])
        setShareDeliveryId(payload.deliveryId)
        setShareExpiresAt(payload.expiresAt)
        setShareLinkScope(payload.scopeType ?? 'all')
      } catch (error) {
        setShareMessage(error instanceof Error ? error.message : 'This share link is invalid or unavailable.')
        setShareAssets([])
        setShareDeliveryId('')
        setShareExpiresAt('')
        setShareLinkScope('all')
        setShareAssetPreviewUrls({})
        setShareAssetThumbnailUrls({})
      }
      setShareBusy(false)
    }

    void loadShareView()
  }, [token])

  // ── Share thumbnail loading ─────────────────────────────────────────
  useEffect(() => {
    if (!token || shareAssets.length === 0) return

    const missingThumbnailAssets = shareAssets.filter(
      (asset) => asset.mime_type.startsWith('image/') && !shareAssetThumbnailUrls[asset.id],
    )

    if (missingThumbnailAssets.length === 0) return

    let cancelled = false

    const loadThumbnailUrls = async () => {
      const payload = await workerRequest<{ urls: Record<string, string> }>(
        '/api/v1/media/preview-url-batch',
        '',
        {
          method: 'POST',
          body: { assetIds: missingThumbnailAssets.map((asset) => asset.id), variant: 'thumb', shareToken: token },
        },
      )

      if (cancelled) return
      setShareAssetThumbnailUrls((current) => ({ ...current, ...(payload.urls ?? {}) }))
    }

    void loadThumbnailUrls()
    return () => {
      cancelled = true
    }
  }, [shareAssetThumbnailUrls, shareAssets, token])

  // ── Customer lightbox preview URL loading ───────────────────────────
  useEffect(() => {
    if (!customerLightboxAsset) return
    if (customerPreviewUrls[customerLightboxAsset.id]) return

    let cancelled = false

    const loadPreviewUrl = async () => {
      try {
        const payload = await workerRequest<{ signedUrl?: string; url?: string }>(
          '/api/v1/media/signed-url',
          '',
          {
            method: 'POST',
            body: { assetId: customerLightboxAsset.id, mode: 'view', shareToken: token },
          },
        )

        if (cancelled) return

        const nextUrl = payload.signedUrl ?? payload.url
        if (!nextUrl) return

        setShareAssetPreviewUrls((current) => ({
          ...current,
          [customerLightboxAsset.id]: nextUrl,
        }))
      } catch {
        // The lightbox can still fall back to the thumbnail while the preview URL is unavailable.
      }
    }

    void loadPreviewUrl()
    return () => {
      cancelled = true
    }
  }, [customerLightboxAsset, customerPreviewUrls, token])

  // ── Handlers ────────────────────────────────────────────────────────
  const handleCopySharedGalleryLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setSharePageCopyState('Copied')
      window.setTimeout(() => setSharePageCopyState(''), 1800)
    } catch {
      setSharePageCopyState('Copy failed')
      window.setTimeout(() => setSharePageCopyState(''), 1800)
    }
  }

  const handleOpenAsset = async (assetId: string, mode: 'view' | 'download') => {
    try {
      const endpoint = '/api/v1/media/signed-url'
      const payload = await workerRequest<{ signedUrl?: string; url?: string }>(endpoint, '', {
        method: 'POST',
        body: { assetId, mode, shareToken: token },
      })
      const nextUrl = payload.url ?? payload.signedUrl
      if (!nextUrl) throw new Error('Missing asset URL')
      window.open(nextUrl, '_blank', 'noopener,noreferrer')
    } catch (error) {
      setShareMessage(error instanceof Error ? error.message : 'Unable to open file')
    }
  }

  const openCustomerLightbox = (deliveryId: string, assetId: string) => {
    setCustomerLightbox({ deliveryId, assetId })
  }

  const closeCustomerLightbox = () => setCustomerLightbox(null)

  const moveCustomerLightbox = (direction: 'prev' | 'next') => {
    if (!customerLightbox || !customerLightboxAsset || customerLightboxIndex < 0) return
    const nextIndex = direction === 'next' ? customerLightboxIndex + 1 : customerLightboxIndex - 1
    if (nextIndex < 0 || nextIndex >= customerLightboxAssets.length) return
    setCustomerLightbox({
      deliveryId: customerLightbox.deliveryId,
      assetId: customerLightboxAssets[nextIndex].id,
    })
  }

  // ── Main render ─────────────────────────────────────────────────────
  return (
    <section className="portal-section">
      <div className="portal-head">
        <div>
          <h2>Shared Gallery</h2>
          <p className="share-gallery-copy">
            {shareLinkScope === 'selected'
              ? 'This shared link includes selected files only. Tap a file to preview it in place.'
              : 'This shared link is view-only. Tap a file to preview it in place.'}
          </p>
        </div>
        <div className="customer-summary-strip">
          <div className="admin-stat-card">
            <span>Scope</span>
            <strong>{shareLinkScope === 'selected' ? 'Selected files' : 'All files'}</strong>
          </div>
          <div className="admin-stat-card">
            <span>Files</span>
            <strong>{shareAssets.length}</strong>
          </div>
          <div className="admin-stat-card">
            <span>Images</span>
            <strong>{shareAssets.filter((asset) => asset.mime_type.startsWith('image/')).length}</strong>
          </div>
          <div className="admin-stat-card">
            <span>Expires</span>
            <strong>{daysRemainingText(shareExpiresAt || null)}</strong>
          </div>
        </div>
      </div>

      <div className="share-link-row share-link-row-wide">
        <input className="share-link-input" value={window.location.href} readOnly />
        <button className="button ghost" type="button" onClick={() => void handleCopySharedGalleryLink()}>
          {sharePageCopyState || 'Copy link'}
        </button>
      </div>

      {shareBusy && <SkeletonGrid count={8} />}
      {shareMessage && <p className="portal-error">{shareMessage}</p>}

      {!shareBusy && !shareMessage && shareAssets.length === 0 && (
        <p className="portal-hint">No files are available in this shared gallery yet.</p>
      )}

      {!shareBusy && !shareMessage && shareAssets.length > 0 && (
        <div className="customer-asset-grid">
          {shareAssets.map((asset) => {
            const isImage = asset.mime_type.startsWith('image/')
            const thumbnailUrl = shareAssetThumbnailUrls[asset.id]
            const displayName = getDisplayFileName(asset.filename)

            return (
              <article key={asset.id} className="customer-asset-card">
                {isImage ? (
                  <button
                    className="customer-asset-thumb customer-asset-thumb-button"
                    type="button"
                    onClick={() => openCustomerLightbox(shareDeliveryId, asset.id)}
                    aria-label={`Open ${displayName}`}
                    disabled={!thumbnailUrl}
                  >
                    {thumbnailUrl ? (
                      <img src={thumbnailUrl} alt={displayName} loading="lazy" decoding="async" />
                    ) : (
                      <div className="customer-asset-thumb-fallback">
                        <span>IMG</span>
                      </div>
                    )}
                  </button>
                ) : (
                  <div className="customer-asset-thumb">
                    <div className="customer-asset-thumb-fallback">
                      <span>{asset.mime_type.split('/')[0]?.slice(0, 1).toUpperCase() || 'F'}</span>
                    </div>
                  </div>
                )}
                <div className="customer-asset-main">
                  <p className="customer-asset-name">{displayName}</p>
                  {!isImage && <p className="portal-hint">{getAssetKind(asset.mime_type)}</p>}
                </div>
                {!isImage && (
                  <div className="customer-asset-actions">
                    <button
                      className="button ghost"
                      type="button"
                      onClick={() => {
                        void handleOpenAsset(asset.id, 'view')
                      }}
                    >
                      Open
                    </button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}

      {customerLightboxAsset && customerLightbox && (
        <CustomerLightbox
          asset={customerLightboxAsset}
          previewUrl={customerPreviewUrls[customerLightboxAsset.id]}
          thumbnailUrl={customerThumbnailUrls[customerLightboxAsset.id]}
          index={customerLightboxIndex}
          total={customerLightboxAssets.length}
          onClose={closeCustomerLightbox}
          onMove={moveCustomerLightbox}
        />
      )}
    </section>
  )
}
