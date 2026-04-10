import { Lightbox } from './Lightbox'

interface CustomerLightboxAsset {
  id: string
  filename: string
  canDownload?: boolean
}

interface CustomerLightboxProps {
  asset: CustomerLightboxAsset
  previewUrl: string | undefined
  thumbnailUrl: string | undefined
  index: number
  total: number
  onClose: () => void
  onMove: (direction: 'prev' | 'next') => void
  onDownload?: (assetId: string) => void
}

export function CustomerLightbox({
  asset,
  previewUrl,
  thumbnailUrl,
  index,
  total,
  onClose,
  onMove,
  onDownload,
}: CustomerLightboxProps) {
  const displayUrl = previewUrl ?? thumbnailUrl
  const canDownload = Boolean(onDownload && asset.canDownload)

  return (
    <Lightbox
      imageKey={asset.id}
      index={index}
      total={total}
      onClose={onClose}
      onMove={onMove}
      renderImage={() =>
        displayUrl ? (
          <img key={asset.id} src={displayUrl} alt={`${asset.filename} — ${index + 1} of ${total}`} />
        ) : (
          <div className="customer-lightbox-loading">Loading preview…</div>
        )
      }
      bottomBar={
        onDownload ? (
          <button
            className="button ghost"
            type="button"
            disabled={!canDownload}
            onClick={() => onDownload(asset.id)}
          >
            Download
          </button>
        ) : undefined
      }
    />
  )
}
