import { useEffect, useRef } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { getDisplayFileName } from '../lib/upload'

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
  const trapRef = useFocusTrap(true)
  const touchStartRef = useRef<number | null>(null)

  const displayUrl = previewUrl ?? thumbnailUrl
  const displayName = getDisplayFileName(asset.filename)
  const canDownload = Boolean(onDownload && asset.canDownload)

  // Keyboard navigation
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        onMove('prev')
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        onMove('next')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, onMove])

  return (
    <div
      ref={trapRef}
      className="customer-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={displayName}
      onClick={onClose}
      onTouchStart={(event) => {
        touchStartRef.current = event.touches[0]?.clientX ?? null
      }}
      onTouchEnd={(event) => {
        const start = touchStartRef.current
        touchStartRef.current = null
        if (start === null) return
        const delta = event.changedTouches[0]?.clientX - start
        if (Math.abs(delta) < 48) return
        if (delta < 0) {
          onMove('next')
        } else {
          onMove('prev')
        }
      }}
    >
      <div className="customer-lightbox-panel" onClick={(event) => event.stopPropagation()}>
        <button className="customer-lightbox-close" type="button" onClick={onClose}>
          Close
        </button>
        <div className="customer-lightbox-stage">
          {displayUrl ? (
            <img src={displayUrl} alt={displayName} />
          ) : (
            <div className="customer-lightbox-loading">Loading preview…</div>
          )}
        </div>
        <div className="customer-lightbox-meta">
          <p className="customer-lightbox-name">{displayName}</p>
          <div className="customer-lightbox-actions">
            <button
              className="button ghost"
              type="button"
              onClick={() => onMove('prev')}
              disabled={index <= 0}
            >
              Previous
            </button>
            <button
              className="button ghost"
              type="button"
              onClick={() => onMove('next')}
              disabled={index >= total - 1}
            >
              Next
            </button>
            {onDownload && (
              <button
                className="button ghost"
                type="button"
                disabled={!canDownload}
                onClick={() => {
                  onDownload(asset.id)
                }}
              >
                Download
              </button>
            )}
          </div>
          <p className="portal-hint">
            {index + 1} / {total}
          </p>
        </div>
      </div>
    </div>
  )
}
