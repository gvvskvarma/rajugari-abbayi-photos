import { useMyPictures } from '../hooks/useMyPictures'
import { CustomerLightbox } from '../components/CustomerLightbox'
import { CustomerDeliveryCard } from '../components/CustomerDeliveryCard'
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
        {pics.myDeliveries.map((delivery) => (
          <CustomerDeliveryCard key={delivery.deliveryId} delivery={delivery} pics={pics} />
        ))}
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
