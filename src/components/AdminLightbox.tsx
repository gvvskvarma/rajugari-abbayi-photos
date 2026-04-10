import { Lightbox } from './Lightbox'

interface AdminLightboxProps {
  asset: { id: string; filename: string }
  previewUrl: string | undefined
  index: number
  total: number
  onClose: () => void
  onMove: (direction: 'prev' | 'next') => void
  onDownload: (assetId: string) => void
}

export function AdminLightbox({
  asset,
  previewUrl,
  index,
  total,
  onClose,
  onMove,
  onDownload,
}: AdminLightboxProps) {
  return (
    <Lightbox
      imageKey={asset.id}
      index={index}
      total={total}
      onClose={onClose}
      onMove={onMove}
      renderImage={() =>
        previewUrl ? (
          <img key={asset.id} src={previewUrl} alt={`${asset.filename} — ${index + 1} of ${total}`} />
        ) : (
          <div className="customer-lightbox-loading">Loading preview…</div>
        )
      }
      bottomBar={
        <button
          className="button ghost"
          type="button"
          onClick={() => onDownload(asset.id)}
        >
          Download
        </button>
      }
    />
  )
}
