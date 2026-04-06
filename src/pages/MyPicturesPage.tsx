import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { CustomerLightboxState, ShareLinkScope } from '../types'
import { useAuth } from '../hooks/useAuth'
import { loadWorkerBlob, triggerBrowserDownload, workerRequest } from '../hooks/useApi'
import { getDisplayFileName, sanitizeDownloadName } from '../lib/upload'
import { getAssetKind } from '../lib/helpers'
import { useMyDeliveries } from '../hooks/queries/useMyDeliveries'
import { useThumbnailBatch } from '../hooks/queries/useThumbnailBatch'
import { usePreviewUrl } from '../hooks/queries/usePreviewUrl'
import { CustomerLightbox } from '../components/CustomerLightbox'
import { SkeletonCardList } from '../components/Skeleton'
import { useDocumentMeta } from '../hooks/useDocumentMeta.ts'

export function MyPicturesPage() {
  useDocumentMeta('Your Gallery', 'View, download, and share your photos from Rajugari Abbayi Photography.')
  const { session, getAccessToken } = useAuth()
  const email = session?.user.email

  // ── Query hooks ───────────────────────────────────────────────────────
  const deliveriesQuery = useMyDeliveries(email)
  const myDeliveries = deliveriesQuery.data ?? []

  // Collect all image asset IDs for thumbnail batch loading
  const imageAssetIds = useMemo(
    () =>
      myDeliveries
        .flatMap((d) => d.assets)
        .filter((a) => a.mime_type.startsWith('image/'))
        .map((a) => a.id),
    [myDeliveries],
  )

  const thumbnailQuery = useThumbnailBatch(imageAssetIds, { getAccessToken })
  const customerThumbnailUrls = thumbnailQuery.data ?? {}

  // ── Unified selection state ──────────────────────────────────────────
  const [selectDeliveryId, setSelectDeliveryId] = useState('')
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])
  const [actionMessage, setActionMessage] = useState('')

  // ── Share link result state ──────────────────────────────────────────
  const [newShareLinks, setNewShareLinks] = useState<Record<string, string>>({})
  const [newShareLinkScopes, setNewShareLinkScopes] = useState<Record<string, ShareLinkScope>>({})
  const [shareCopyState, setShareCopyState] = useState<Record<string, string>>({})

  // ── Lightbox state ───────────────────────────────────────────────────
  const [customerLightbox, setCustomerLightbox] = useState<CustomerLightboxState | null>(null)

  // Preview URL for the active lightbox asset
  const lightboxAssetId = customerLightbox?.assetId ?? ''
  const previewQuery = usePreviewUrl(lightboxAssetId, { getAccessToken })

  // ── Computed values ──────────────────────────────────────────────────
  const selectedAssetSet = useMemo(() => new Set(selectedAssetIds), [selectedAssetIds])
  const selectedCount = selectedAssetIds.length

  const customerVisibleAssets = useMemo(
    () => myDeliveries.flatMap((delivery) => delivery.assets),
    [myDeliveries],
  )

  const customerLightboxAssets = useMemo(() => {
    if (!customerLightbox) return []
    const delivery = myDeliveries.find((entry) => entry.deliveryId === customerLightbox.deliveryId)
    return (delivery?.assets ?? []).filter((asset) => asset.mime_type.startsWith('image/'))
  }, [customerLightbox, myDeliveries])

  const customerLightboxIndex = useMemo(() => {
    if (!customerLightbox) return -1
    return customerLightboxAssets.findIndex((asset) => asset.id === customerLightbox.assetId)
  }, [customerLightbox, customerLightboxAssets])

  const customerLightboxAsset = customerLightboxIndex >= 0 ? customerLightboxAssets[customerLightboxIndex] : null

  const customerPreviewUrls: Record<string, string> = useMemo(() => {
    if (!lightboxAssetId || !previewQuery.data) return {}
    return { [lightboxAssetId]: previewQuery.data }
  }, [lightboxAssetId, previewQuery.data])

  // Derive loading/error from query states
  const customerBusy = deliveriesQuery.isLoading
  const customerError = deliveriesQuery.error
    ? deliveriesQuery.error instanceof Error
      ? deliveriesQuery.error.message
      : 'Failed to load deliveries'
    : ''

  // ── Mutations ────────────────────────────────────────────────────────

  const downloadAllMutation = useMutation({
    mutationFn: async (deliveryId: string) => {
      const token = await getAccessToken()
      if (!token) throw new Error('Login session expired. Please log in again.')
      const delivery = myDeliveries.find((d) => d.deliveryId === deliveryId)
      const blob = await loadWorkerBlob(`/api/v1/deliveries/${deliveryId}/download`, token, {
        method: 'POST',
        body: {},
      })
      const name = sanitizeDownloadName(delivery?.projectName || delivery?.clientName || 'photos')
      triggerBrowserDownload(blob, `${name}.zip`)
    },
    onError: (error: Error) => {
      setActionMessage(error.message)
    },
  })

  const downloadSelectedMutation = useMutation({
    mutationFn: async ({ deliveryId, assetIds }: { deliveryId: string; assetIds: string[] }) => {
      const token = await getAccessToken()
      if (!token) throw new Error('Login session expired. Please log in again.')
      const delivery = myDeliveries.find((d) => d.deliveryId === deliveryId)
      const blob = await loadWorkerBlob(`/api/v1/deliveries/${deliveryId}/download`, token, {
        method: 'POST',
        body: { assetIds },
      })
      const name = sanitizeDownloadName(delivery?.projectName || delivery?.clientName || 'photos')
      triggerBrowserDownload(blob, `${name}-selected.zip`)
    },
    onSuccess: () => exitSelectMode(),
    onError: (error: Error) => {
      setActionMessage(error.message)
    },
  })

  const shareAllMutation = useMutation({
    mutationFn: async (deliveryId: string) => {
      const token = await getAccessToken()
      if (!token) throw new Error('Login session expired. Please log in again.')
      const payload = await workerRequest<{ url: string; scopeType: ShareLinkScope }>(
        '/api/v1/share-links',
        token,
        { method: 'POST', body: { deliveryId, expiresInDays: 7, scope: 'all', assetIds: [] } },
      )
      return { deliveryId, url: payload.url, scopeType: payload.scopeType ?? 'all' as ShareLinkScope }
    },
    onSuccess: ({ deliveryId, url, scopeType }) => {
      setNewShareLinks((current) => ({ ...current, [deliveryId]: url }))
      setNewShareLinkScopes((current) => ({ ...current, [deliveryId]: scopeType }))
      setShareCopyState((current) => ({ ...current, [deliveryId]: '' }))
    },
    onError: (error: Error) => {
      setActionMessage(error.message)
    },
  })

  const shareSelectedMutation = useMutation({
    mutationFn: async ({ deliveryId, assetIds }: { deliveryId: string; assetIds: string[] }) => {
      const token = await getAccessToken()
      if (!token) throw new Error('Login session expired. Please log in again.')
      const payload = await workerRequest<{ url: string; scopeType: ShareLinkScope }>(
        '/api/v1/share-links',
        token,
        {
          method: 'POST',
          body: { deliveryId, expiresInDays: 7, scope: 'selected', assetIds: [...new Set(assetIds)] },
        },
      )
      return { deliveryId, url: payload.url, scopeType: payload.scopeType ?? 'selected' as ShareLinkScope }
    },
    onSuccess: ({ deliveryId, url, scopeType }) => {
      setNewShareLinks((current) => ({ ...current, [deliveryId]: url }))
      setNewShareLinkScopes((current) => ({ ...current, [deliveryId]: scopeType }))
      setShareCopyState((current) => ({ ...current, [deliveryId]: '' }))
      exitSelectMode()
    },
    onError: (error: Error) => {
      setActionMessage(error.message)
    },
  })

  const actionBusy =
    downloadAllMutation.isPending ||
    downloadSelectedMutation.isPending ||
    shareAllMutation.isPending ||
    shareSelectedMutation.isPending

  // ── Unified selection handlers ──────────────────────────────────────

  const startSelectMode = (deliveryId: string) => {
    setSelectDeliveryId(deliveryId)
    setSelectedAssetIds([])
    setActionMessage('')
  }

  const exitSelectMode = () => {
    setSelectDeliveryId('')
    setSelectedAssetIds([])
    setActionMessage('')
  }

  const toggleAsset = (assetId: string) => {
    setSelectedAssetIds((current) =>
      current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId],
    )
  }

  const selectAllAssets = (deliveryId: string) => {
    const delivery = myDeliveries.find((d) => d.deliveryId === deliveryId)
    if (!delivery) return
    setSelectedAssetIds(delivery.assets.filter((a) => a.canDownload).map((a) => a.id))
  }

  const clearSelection = () => setSelectedAssetIds([])

  // ── Download handlers ───────────────────────────────────────────────

  const handleDownloadAll = (deliveryId: string) => {
    downloadAllMutation.mutate(deliveryId)
  }

  const handleDownloadSelected = () => {
    if (selectedAssetIds.length === 0 || !selectDeliveryId) return
    downloadSelectedMutation.mutate({ deliveryId: selectDeliveryId, assetIds: selectedAssetIds })
  }

  // ── Share link handlers ─────────────────────────────────────────────

  const handleShareAll = (deliveryId: string) => {
    shareAllMutation.mutate(deliveryId)
  }

  const handleShareSelected = () => {
    if (selectedAssetIds.length === 0 || !selectDeliveryId) return
    shareSelectedMutation.mutate({ deliveryId: selectDeliveryId, assetIds: selectedAssetIds })
  }

  const handleCopyShareLink = async (deliveryId: string) => {
    const link = newShareLinks[deliveryId]
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setShareCopyState((current) => ({ ...current, [deliveryId]: 'Copied' }))
    } catch {
      setShareCopyState((current) => ({ ...current, [deliveryId]: 'Copy failed' }))
    }
  }

  // ── Asset open handler ───────────────────────────────────────────────

  const handleOpenAsset = async (assetId: string, mode: 'view' | 'download') => {
    try {
      const token = await getAccessToken()
      if (!token) {
        setActionMessage('Login session expired. Please log in again.')
        return
      }

      const endpoint = mode === 'view' ? '/api/v1/media/preview-url' : '/api/v1/media/signed-url'
      const payload = await workerRequest<{ signedUrl?: string; url?: string }>(endpoint, token, {
        method: 'POST',
        body: { assetId, mode },
      })
      const nextUrl = payload.url ?? payload.signedUrl
      if (!nextUrl) throw new Error('Missing asset URL')
      window.open(nextUrl, '_blank', 'noopener,noreferrer')
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Unable to open file')
    }
  }

  // ── Lightbox handlers ────────────────────────────────────────────────

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

  // ── Auth guard ───────────────────────────────────────────────────────

  if (!email) {
    return (
      <section className="portal-section">
        <h2>Your Gallery</h2>
        <p className="portal-empty-message">
          Your photos are waiting for you. Log in with your email to view, download, and share your moments.
        </p>
      </section>
    )
  }

  // ── Main render ──────────────────────────────────────────────────────

  return (
    <section className="portal-section">
      <div className="portal-head">
        <div>
          <h2>Your Gallery</h2>
          <p>Logged in as <strong>{email}</strong>. Tap any photo to view it full screen.</p>
        </div>
        <div className="customer-summary-strip">
          <div className="admin-stat-card">
            <span>Albums</span>
            <strong>{myDeliveries.length}</strong>
          </div>
          <div className="admin-stat-card">
            <span>Photos</span>
            <strong>{customerVisibleAssets.length}</strong>
          </div>
          <div className="admin-stat-card">
            <span>Ready to download</span>
            <strong>{myDeliveries.filter((delivery) => delivery.accessMode !== 'viewer').length}</strong>
          </div>
        </div>
      </div>

      {customerBusy && <SkeletonCardList count={3} />}
      {customerError && <p className="portal-error">{customerError}</p>}
      {!customerBusy && !customerError && myDeliveries.length === 0 && (
        <p className="portal-hint">No active deliveries found for this email.</p>
      )}

      <div className="delivery-list">
        {myDeliveries.map((delivery) => {
          const isSelectMode = selectDeliveryId === delivery.deliveryId
          const canAct = delivery.accessMode !== 'viewer'

          return (
            <article key={delivery.deliveryId} className="delivery-card">
              <div className="delivery-header">
                <div>
                  <p className="delivery-title">{delivery.projectName || delivery.clientName || 'Your gallery'}</p>
                  <p className="delivery-expiry">
                    {delivery.projectStatus
                      ? delivery.projectStatus.charAt(0).toUpperCase() + delivery.projectStatus.slice(1)
                      : delivery.accessMode === 'viewer'
                        ? 'View only'
                        : 'Available now'}
                  </p>
                </div>
                <div className="delivery-header-actions">
                  <span className="admin-client-count">
                    {delivery.assets.length} file{delivery.assets.length === 1 ? '' : 's'}
                  </span>
                </div>
              </div>

              {/* ── Action bar ─────────────────────────────────────── */}
              {canAct && (
                <div className="delivery-action-bar">
                  {isSelectMode ? (
                    <>
                      <button className="button ghost" type="button" onClick={() => selectAllAssets(delivery.deliveryId)} disabled={actionBusy}>
                        Select all
                      </button>
                      <button className="button ghost" type="button" onClick={clearSelection} disabled={actionBusy || selectedCount === 0}>
                        Clear
                      </button>
                      <button
                        className="button ghost"
                        type="button"
                        onClick={handleDownloadSelected}
                        disabled={actionBusy || selectedCount === 0}
                      >
                        {actionBusy ? 'Working...' : `Download selected (${selectedCount})`}
                      </button>
                      <button
                        className="button ghost"
                        type="button"
                        onClick={handleShareSelected}
                        disabled={actionBusy || selectedCount === 0}
                      >
                        {actionBusy ? 'Working...' : `Create share link with selected files (${selectedCount})`}
                      </button>
                      <button className="button ghost" type="button" onClick={exitSelectMode} disabled={actionBusy}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="button ghost"
                        type="button"
                        disabled={actionBusy}
                        onClick={() => handleDownloadAll(delivery.deliveryId)}
                      >
                        Download all
                      </button>
                      <button
                        className="button ghost"
                        type="button"
                        disabled={actionBusy}
                        onClick={() => startSelectMode(delivery.deliveryId)}
                      >
                        Select files
                      </button>
                      <button
                        className="button ghost"
                        type="button"
                        disabled={actionBusy}
                        onClick={() => handleShareAll(delivery.deliveryId)}
                      >
                        Share all
                      </button>
                    </>
                  )}
                </div>
              )}

              {isSelectMode && (
                <p className="portal-hint">Tap photos to select, then download or share them.</p>
              )}
              {actionMessage && selectDeliveryId === delivery.deliveryId && (
                <p className="portal-error">{actionMessage}</p>
              )}

              {/* ── Share link result ──────────────────────────────── */}
              {newShareLinks[delivery.deliveryId] && (
                <div className="share-link-row">
                  <div className="share-link-meta">
                    <span className="share-link-label">
                      {newShareLinkScopes[delivery.deliveryId] === 'selected' ? 'Selected files only' : 'All files in this folder'}
                    </span>
                  </div>
                  <input className="share-link-input" value={newShareLinks[delivery.deliveryId]} readOnly />
                  <button
                    className="button ghost"
                    type="button"
                    onClick={() => {
                      void handleCopyShareLink(delivery.deliveryId)
                    }}
                  >
                    {shareCopyState[delivery.deliveryId] || 'Copy'}
                  </button>
                </div>
              )}

              {/* ── Asset grid ────────────────────────────────────── */}
              <div className="customer-asset-grid">
                {delivery.assets.map((asset) => {
                  const isSelected = isSelectMode && selectedAssetSet.has(asset.id)
                  const displayName = getDisplayFileName(asset.filename)
                  const isImage = asset.mime_type.startsWith('image/')
                  const thumbnailUrl = customerThumbnailUrls[asset.id]

                  return (
                    <article key={asset.id} className={`customer-asset-card ${isSelected ? 'is-selected' : ''}`}>
                      {isSelectMode && (
                        <button
                          className="customer-asset-select-overlay"
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => toggleAsset(asset.id)}
                          disabled={actionBusy}
                        >
                          <span className="customer-asset-check">{isSelected ? '✓' : ''}</span>
                          <span className="sr-only">Select {displayName}</span>
                        </button>
                      )}
                      {isImage ? (
                        <button
                          className="customer-asset-thumb customer-asset-thumb-button"
                          type="button"
                          onClick={() => isSelectMode ? toggleAsset(asset.id) : openCustomerLightbox(delivery.deliveryId, asset.id)}
                          aria-label={isSelectMode ? `Select ${displayName}` : `Open ${displayName}`}
                          disabled={!isSelectMode && !thumbnailUrl}
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
                        {!isImage && (
                          <>
                            <p className="customer-asset-name">{displayName}</p>
                            <p className="portal-hint">{getAssetKind(asset.mime_type)}</p>
                          </>
                        )}
                      </div>
                      {!isSelectMode && (
                        <div className="customer-asset-actions">
                          {!isImage && (
                            <button className="button ghost" type="button" onClick={() => { void handleOpenAsset(asset.id, 'view') }}>
                              Open
                            </button>
                          )}
                          <button className="button ghost" type="button" disabled={!asset.canDownload} onClick={() => { void handleOpenAsset(asset.id, 'download') }}>
                            Download
                          </button>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            </article>
          )
        })}
      </div>

      {customerLightboxAsset && customerLightbox && (
        <CustomerLightbox
          asset={customerLightboxAsset}
          previewUrl={customerPreviewUrls[customerLightboxAsset.id]}
          thumbnailUrl={customerThumbnailUrls[customerLightboxAsset.id]}
          index={customerLightboxIndex}
          total={customerLightboxAssets.length}
          onClose={closeCustomerLightbox}
          onMove={moveCustomerLightbox}
          onDownload={(assetId) => { void handleOpenAsset(assetId, 'download') }}
        />
      )}
    </section>
  )
}
