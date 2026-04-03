import { useEffect, useMemo, useRef, useState } from 'react'
import type { CustomerLightboxState, DeliveryCard, ShareLinkScope } from '../types'
import { useAuth } from '../hooks/useAuth'
import { workerRequest, loadWorkerBlob, triggerBrowserDownload } from '../hooks/useApi'
import { getDisplayFileName, sanitizeDownloadName } from '../lib/upload'
import { getAssetKind } from '../lib/helpers'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { supabase } from '../lib/supabase'

export function MyPicturesPage() {
  const { session, getAccessToken } = useAuth()

  // ── Customer delivery state ──────────────────────────────────────────
  const [myDeliveries, setMyDeliveries] = useState<DeliveryCard[]>([])
  const [customerError, setCustomerError] = useState('')
  const [customerBusy, setCustomerBusy] = useState(false)

  // ── Unified selection state ──────────────────────────────────────────
  const [selectDeliveryId, setSelectDeliveryId] = useState('')
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])
  const [actionBusy, setActionBusy] = useState(false)
  const [actionMessage, setActionMessage] = useState('')

  // ── Share link result state ──────────────────────────────────────────
  const [newShareLinks, setNewShareLinks] = useState<Record<string, string>>({})
  const [newShareLinkScopes, setNewShareLinkScopes] = useState<Record<string, ShareLinkScope>>({})
  const [shareCopyState, setShareCopyState] = useState<Record<string, string>>({})

  // ── Lightbox state ───────────────────────────────────────────────────
  const [customerLightbox, setCustomerLightbox] = useState<CustomerLightboxState | null>(null)
  const [customerAssetPreviewUrls, setCustomerAssetPreviewUrls] = useState<Record<string, string>>({})
  const [customerAssetThumbnailUrls, setCustomerAssetThumbnailUrls] = useState<Record<string, string>>({})

  const customerLightboxTouchStartRef = useRef<number | null>(null)
  const customerLightboxTrapRef = useFocusTrap(Boolean(customerLightbox))

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
  const customerPreviewUrls = customerAssetPreviewUrls
  const customerThumbnailUrls = customerAssetThumbnailUrls

  // ── Effects ──────────────────────────────────────────────────────────

  // Load customer delivery data
  useEffect(() => {
    if (!supabase || !session?.user.email) return

    const loadCustomerData = async () => {
      setCustomerBusy(true)
      setCustomerError('')
      try {
        const token = await getAccessToken()
        if (!token) {
          setCustomerError('Login session expired. Please log in again.')
          setMyDeliveries([])
          setCustomerBusy(false)
          return
        }
        const payload = await workerRequest<{ deliveries: DeliveryCard[] }>('/api/v1/my-pictures', token)
        setMyDeliveries(payload.deliveries ?? [])
      } catch (error) {
        setCustomerError(error instanceof Error ? error.message : 'Failed to load deliveries')
      } finally {
        setCustomerBusy(false)
      }
    }

    void loadCustomerData()
  }, [session?.user.email])

  // Load customer thumbnails (batch)
  useEffect(() => {
    if (!supabase || !session?.user.id || myDeliveries.length === 0) return

    const missingThumbnailAssets = myDeliveries
      .flatMap((delivery) => delivery.assets.map((asset) => ({ deliveryId: delivery.deliveryId, asset })))
      .filter(
        ({ asset }) => asset.mime_type.startsWith('image/') && !customerAssetThumbnailUrls[asset.id],
      )

    if (missingThumbnailAssets.length === 0) return

    let cancelled = false

    const loadThumbnailUrls = async () => {
      const token = await getAccessToken()
      if (!token) return

      const payload = await workerRequest<{ urls: Record<string, string> }>('/api/v1/media/preview-url-batch', token, {
        method: 'POST',
        body: { assetIds: missingThumbnailAssets.map(({ asset }) => asset.id), variant: 'thumb' },
      })

      if (cancelled) return
      setCustomerAssetThumbnailUrls((current) => ({ ...current, ...(payload.urls ?? {}) }))
    }

    void loadThumbnailUrls()
    return () => {
      cancelled = true
    }
  }, [customerAssetThumbnailUrls, myDeliveries, session?.user.id])

  // Load lightbox preview URL
  useEffect(() => {
    if (!customerLightboxAsset) return
    if (customerPreviewUrls[customerLightboxAsset.id]) return

    let cancelled = false

    const loadPreviewUrl = async () => {
      try {
        if (!supabase || !session?.user.id) return
        const token = await getAccessToken()
        if (!token) return
        const payload = await workerRequest<{ url: string }>('/api/v1/media/preview-url', token, {
          method: 'POST',
          body: { assetId: customerLightboxAsset.id },
        })

        if (cancelled || !payload) return

        const nextUrl = payload.url
        if (!nextUrl) return

        setCustomerAssetPreviewUrls((current) => ({
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
  }, [customerLightboxAsset, customerPreviewUrls, session?.user.id])

  // Lightbox keyboard navigation
  useEffect(() => {
    if (!customerLightboxAsset) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setCustomerLightbox(null)
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        const nextIndex = customerLightboxIndex - 1
        if (nextIndex >= 0) {
          setCustomerLightbox({
            deliveryId: customerLightbox?.deliveryId ?? '',
            assetId: customerLightboxAssets[nextIndex].id,
          })
        }
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        const nextIndex = customerLightboxIndex + 1
        if (nextIndex < customerLightboxAssets.length) {
          setCustomerLightbox({
            deliveryId: customerLightbox?.deliveryId ?? '',
            assetId: customerLightboxAssets[nextIndex].id,
          })
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [customerLightbox, customerLightboxAsset, customerLightboxAssets, customerLightboxIndex])

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

  const handleDownloadAll = async (deliveryId: string) => {
    try {
      const token = await getAccessToken()
      if (!token) {
        setCustomerError('Login session expired. Please log in again.')
        return
      }
      setActionBusy(true)
      const delivery = myDeliveries.find((d) => d.deliveryId === deliveryId)
      const blob = await loadWorkerBlob(`/api/v1/deliveries/${deliveryId}/download`, token, {
        method: 'POST',
        body: {},
      })
      const name = sanitizeDownloadName(delivery?.projectName || delivery?.clientName || 'photos')
      triggerBrowserDownload(blob, `${name}.zip`)
    } catch (error) {
      setCustomerError(error instanceof Error ? error.message : 'Download failed')
    } finally {
      setActionBusy(false)
    }
  }

  const handleDownloadSelected = async () => {
    if (selectedAssetIds.length === 0 || !selectDeliveryId) return
    try {
      const token = await getAccessToken()
      if (!token) {
        setCustomerError('Login session expired. Please log in again.')
        return
      }
      setActionBusy(true)
      const delivery = myDeliveries.find((d) => d.deliveryId === selectDeliveryId)
      const blob = await loadWorkerBlob(`/api/v1/deliveries/${selectDeliveryId}/download`, token, {
        method: 'POST',
        body: { assetIds: selectedAssetIds },
      })
      const name = sanitizeDownloadName(delivery?.projectName || delivery?.clientName || 'photos')
      triggerBrowserDownload(blob, `${name}-selected.zip`)
      exitSelectMode()
    } catch (error) {
      setCustomerError(error instanceof Error ? error.message : 'Download failed')
    } finally {
      setActionBusy(false)
    }
  }

  // ── Share link handlers ─────────────────────────────────────────────

  const handleShareAll = async (deliveryId: string) => {
    if (!supabase || !session?.user.id) return
    try {
      setActionBusy(true)
      setActionMessage('')
      const token = await getAccessToken()
      if (!token) {
        setCustomerError('Login session expired. Please log in again.')
        return
      }
      const payload = await workerRequest<{ url: string; scopeType: ShareLinkScope }>(
        '/api/v1/share-links',
        token,
        { method: 'POST', body: { deliveryId, expiresInDays: 7, scope: 'all', assetIds: [] } },
      )
      setNewShareLinks((current) => ({ ...current, [deliveryId]: payload.url }))
      setNewShareLinkScopes((current) => ({ ...current, [deliveryId]: payload.scopeType ?? 'all' }))
      setShareCopyState((current) => ({ ...current, [deliveryId]: '' }))
    } catch (error) {
      setCustomerError(error instanceof Error ? error.message : 'Unable to create share link')
    } finally {
      setActionBusy(false)
    }
  }

  const handleShareSelected = async () => {
    if (selectedAssetIds.length === 0 || !selectDeliveryId) return
    if (!supabase || !session?.user.id) return
    try {
      setActionBusy(true)
      setActionMessage('')
      const token = await getAccessToken()
      if (!token) {
        setCustomerError('Login session expired. Please log in again.')
        return
      }
      const payload = await workerRequest<{ url: string; scopeType: ShareLinkScope }>(
        '/api/v1/share-links',
        token,
        {
          method: 'POST',
          body: { deliveryId: selectDeliveryId, expiresInDays: 7, scope: 'selected', assetIds: [...new Set(selectedAssetIds)] },
        },
      )
      setNewShareLinks((current) => ({ ...current, [selectDeliveryId]: payload.url }))
      setNewShareLinkScopes((current) => ({ ...current, [selectDeliveryId]: payload.scopeType ?? 'selected' }))
      setShareCopyState((current) => ({ ...current, [selectDeliveryId]: '' }))
      exitSelectMode()
    } catch (error) {
      setCustomerError(error instanceof Error ? error.message : 'Unable to create share link')
    } finally {
      setActionBusy(false)
    }
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
    if (!supabase) return
    try {
      const token = await getAccessToken()
      if (!token) {
        setCustomerError('Login session expired. Please log in again.')
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
      setCustomerError(error instanceof Error ? error.message : 'Unable to open file')
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

  // ── Lightbox renderer ────────────────────────────────────────────────

  const renderCustomerLightbox = () => {
    if (!customerLightboxAsset || !customerLightbox) return null

    const previewUrl = customerPreviewUrls[customerLightboxAsset.id] ?? customerThumbnailUrls[customerLightboxAsset.id]
    const canDownload = Boolean(customerLightboxAsset.canDownload)

    return (
      <div
        ref={customerLightboxTrapRef}
        className="customer-lightbox"
        role="dialog"
        aria-modal="true"
        aria-label={getDisplayFileName(customerLightboxAsset.filename)}
        onClick={closeCustomerLightbox}
        onTouchStart={(event) => {
          customerLightboxTouchStartRef.current = event.touches[0]?.clientX ?? null
        }}
        onTouchEnd={(event) => {
          const start = customerLightboxTouchStartRef.current
          customerLightboxTouchStartRef.current = null
          if (start === null) return
          const delta = event.changedTouches[0]?.clientX - start
          if (Math.abs(delta) < 48) return
          if (delta < 0) {
            moveCustomerLightbox('next')
          } else {
            moveCustomerLightbox('prev')
          }
        }}
      >
        <div className="customer-lightbox-panel" onClick={(event) => event.stopPropagation()}>
          <button className="customer-lightbox-close" type="button" onClick={closeCustomerLightbox}>
            Close
          </button>
          <div className="customer-lightbox-stage">
            {previewUrl ? (
              <img src={previewUrl} alt={getDisplayFileName(customerLightboxAsset.filename)} />
            ) : (
              <div className="customer-lightbox-loading">Loading preview…</div>
            )}
          </div>
          <div className="customer-lightbox-meta">
            <p className="customer-lightbox-name">{getDisplayFileName(customerLightboxAsset.filename)}</p>
            <div className="customer-lightbox-actions">
              <button
                className="button ghost"
                type="button"
                onClick={() => moveCustomerLightbox('prev')}
                disabled={customerLightboxIndex <= 0}
              >
                Previous
              </button>
              <button
                className="button ghost"
                type="button"
                onClick={() => moveCustomerLightbox('next')}
                disabled={customerLightboxIndex >= customerLightboxAssets.length - 1}
              >
                Next
              </button>
              <button
                className="button ghost"
                type="button"
                disabled={!canDownload}
                onClick={() => {
                  void handleOpenAsset(customerLightboxAsset.id, 'download')
                }}
              >
                Download
              </button>
            </div>
            <p className="portal-hint">
              {customerLightboxIndex + 1} / {customerLightboxAssets.length}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Auth guard ───────────────────────────────────────────────────────

  if (!session?.user.email) {
    return (
      <section className="portal-section">
        <h2>My Pictures</h2>
        <p>Log in with your email OTP to view your photos and videos.</p>
      </section>
    )
  }

  // ── Main render ──────────────────────────────────────────────────────

  return (
    <section className="portal-section">
      <div className="portal-head">
        <div>
          <h2>My Pictures</h2>
          <p>Media matched to <strong>{session.user.email}</strong>. Tap a photo to open it full screen.</p>
        </div>
        <div className="customer-summary-strip">
          <div className="admin-stat-card">
            <span>Deliveries</span>
            <strong>{myDeliveries.length}</strong>
          </div>
          <div className="admin-stat-card">
            <span>Files</span>
            <strong>{customerVisibleAssets.length}</strong>
          </div>
          <div className="admin-stat-card">
            <span>Available</span>
            <strong>{myDeliveries.filter((delivery) => delivery.accessMode !== 'viewer').length}</strong>
          </div>
        </div>
      </div>

      {customerBusy && <p className="portal-hint">Loading your deliveries...</p>}
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
                        onClick={() => { void handleDownloadSelected() }}
                        disabled={actionBusy || selectedCount === 0}
                      >
                        {actionBusy ? 'Working...' : `Download (${selectedCount})`}
                      </button>
                      <button
                        className="button ghost"
                        type="button"
                        onClick={() => { void handleShareSelected() }}
                        disabled={actionBusy || selectedCount === 0}
                      >
                        {actionBusy ? 'Working...' : `Share (${selectedCount})`}
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
                        onClick={() => { void handleDownloadAll(delivery.deliveryId) }}
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
                        onClick={() => { void handleShareAll(delivery.deliveryId) }}
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
                        <p className="customer-asset-name">{displayName}</p>
                        {!isImage && <p className="portal-hint">{getAssetKind(asset.mime_type)}</p>}
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

      {customerLightboxAsset && customerLightbox && renderCustomerLightbox()}
    </section>
  )
}
