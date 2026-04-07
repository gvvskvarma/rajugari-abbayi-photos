import { useMyPictures } from '../hooks/useMyPictures'
import { getDisplayFileName } from '../lib/upload'
import { getAssetKind } from '../lib/helpers'
import { CustomerLightbox } from '../components/CustomerLightbox'
import { SkeletonCardList } from '../components/Skeleton'
import { useDocumentMeta } from '../hooks/useDocumentMeta.ts'

export function MyPicturesPage() {
  useDocumentMeta('Your Gallery', 'View, download, and share your photos from Rajugari Abbayi Photography.')
  const pics = useMyPictures()

  // ── Auth guard ───────────────────────────────────────────────────────
  if (!pics.email) {
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
          <p>Logged in as <strong>{pics.email}</strong>. Tap any photo to view it full screen.</p>
        </div>
        <div className="customer-summary-strip">
          <div className="admin-stat-card"><span>Albums</span><strong>{pics.myDeliveries.length}</strong></div>
          <div className="admin-stat-card"><span>Photos</span><strong>{pics.customerVisibleAssets.length}</strong></div>
          <div className="admin-stat-card"><span>Ready to download</span><strong>{pics.myDeliveries.filter((d) => d.accessMode !== 'viewer').length}</strong></div>
        </div>
      </div>

      {pics.customerBusy && <SkeletonCardList count={3} />}
      {pics.customerError && <p className="portal-error">{pics.customerError}</p>}
      {!pics.customerBusy && !pics.customerError && pics.myDeliveries.length === 0 && (
        <p className="portal-hint">No active deliveries found for this email.</p>
      )}

      <div className="delivery-list">
        {pics.myDeliveries.map((delivery) => {
          const isSelectMode = pics.selectDeliveryId === delivery.deliveryId
          const canAct = delivery.accessMode !== 'viewer'

          return (
            <article key={delivery.deliveryId} className="delivery-card">
              <div className="delivery-header">
                <div>
                  <p className="delivery-title">{delivery.projectName || delivery.clientName || 'Your gallery'}</p>
                  <p className="delivery-expiry">
                    {delivery.projectStatus
                      ? delivery.projectStatus.charAt(0).toUpperCase() + delivery.projectStatus.slice(1)
                      : delivery.accessMode === 'viewer' ? 'View only' : 'Available now'}
                  </p>
                </div>
                <div className="delivery-header-actions">
                  <span className="admin-client-count">{delivery.assets.length} file{delivery.assets.length === 1 ? '' : 's'}</span>
                </div>
              </div>

              {canAct && (
                <div className="delivery-action-bar">
                  {isSelectMode ? (
                    <>
                      <button className="button ghost" type="button" onClick={() => pics.selectAllAssets(delivery.deliveryId)} disabled={pics.actionBusy}>Select all</button>
                      <button className="button ghost" type="button" onClick={pics.clearSelection} disabled={pics.actionBusy || pics.selectedCount === 0}>Clear</button>
                      <button className="button ghost" type="button" onClick={pics.handleDownloadSelected} disabled={pics.actionBusy || pics.selectedCount === 0}>
                        {pics.actionBusy ? 'Working...' : `Download selected (${pics.selectedCount})`}
                      </button>
                      <button className="button ghost" type="button" onClick={pics.handleShareSelected} disabled={pics.actionBusy || pics.selectedCount === 0}>
                        {pics.actionBusy ? 'Working...' : `Create share link with selected files (${pics.selectedCount})`}
                      </button>
                      <button className="button ghost" type="button" onClick={pics.exitSelectMode} disabled={pics.actionBusy}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className="button ghost" type="button" disabled={pics.actionBusy} onClick={() => pics.handleDownloadAll(delivery.deliveryId)}>Download all</button>
                      <button className="button ghost" type="button" disabled={pics.actionBusy} onClick={() => pics.startSelectMode(delivery.deliveryId)}>Select files</button>
                      <button className="button ghost" type="button" disabled={pics.actionBusy} onClick={() => pics.handleShareAll(delivery.deliveryId)}>Share all</button>
                    </>
                  )}
                </div>
              )}

              {isSelectMode && <p className="portal-hint">Tap photos to select, then download or share them.</p>}
              {pics.actionMessage && pics.selectDeliveryId === delivery.deliveryId && <p className="portal-error">{pics.actionMessage}</p>}

              {pics.newShareLinks[delivery.deliveryId] && (
                <div className="share-link-row">
                  <div className="share-link-meta">
                    <span className="share-link-label">
                      {pics.newShareLinkScopes[delivery.deliveryId] === 'selected' ? 'Selected files only' : 'All files in this folder'}
                    </span>
                  </div>
                  <input className="share-link-input" value={pics.newShareLinks[delivery.deliveryId]} readOnly />
                  <button className="button ghost" type="button" onClick={() => { void pics.handleCopyShareLink(delivery.deliveryId) }}>
                    {pics.shareCopyState[delivery.deliveryId] || 'Copy'}
                  </button>
                </div>
              )}

              <div className="customer-asset-grid">
                {delivery.assets.map((asset) => {
                  const isSelected = isSelectMode && pics.selectedAssetSet.has(asset.id)
                  const displayName = getDisplayFileName(asset.filename)
                  const isImage = asset.mime_type.startsWith('image/')
                  const thumbnailUrl = pics.customerThumbnailUrls[asset.id]

                  return (
                    <article key={asset.id} className={`customer-asset-card ${isSelected ? 'is-selected' : ''}`}>
                      {isSelectMode && (
                        <button className="customer-asset-select-overlay" type="button" aria-pressed={isSelected}
                          onClick={() => pics.toggleAsset(asset.id)} disabled={pics.actionBusy}>
                          <span className="customer-asset-check">{isSelected ? '✓' : ''}</span>
                          <span className="sr-only">Select {displayName}</span>
                        </button>
                      )}
                      {isImage ? (
                        <button className="customer-asset-thumb customer-asset-thumb-button" type="button"
                          onClick={() => isSelectMode ? pics.toggleAsset(asset.id) : pics.openCustomerLightbox(delivery.deliveryId, asset.id)}
                          aria-label={isSelectMode ? `Select ${displayName}` : `Open ${displayName}`}
                          disabled={!isSelectMode && !thumbnailUrl}>
                          {thumbnailUrl ? (
                            <img src={thumbnailUrl} alt={displayName} loading="lazy" decoding="async" />
                          ) : (
                            <div className="customer-asset-thumb-fallback"><span>IMG</span></div>
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
                            <button className="button ghost" type="button" onClick={() => { void pics.handleOpenAsset(asset.id, 'view') }}>Open</button>
                          )}
                          <button className="button ghost" type="button" disabled={!asset.canDownload} onClick={() => { void pics.handleOpenAsset(asset.id, 'download') }}>Download</button>
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

      {pics.customerLightboxAsset && pics.customerLightbox && (
        <CustomerLightbox
          asset={pics.customerLightboxAsset}
          previewUrl={pics.customerPreviewUrls[pics.customerLightboxAsset.id]}
          thumbnailUrl={pics.customerThumbnailUrls[pics.customerLightboxAsset.id]}
          index={pics.customerLightboxIndex}
          total={pics.customerLightboxAssets.length}
          onClose={pics.closeCustomerLightbox}
          onMove={pics.moveCustomerLightbox}
          onDownload={(assetId) => { void pics.handleOpenAsset(assetId, 'download') }}
        />
      )}
    </section>
  )
}
