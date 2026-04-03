import { useEffect, useRef } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { getDisplayFileName } from '../lib/upload'

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
  const trapRef = useFocusTrap(true)
  const touchStartRef = useRef<number | null>(null)

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

  const displayName = getDisplayFileName(asset.filename)

  return (
    <div
      ref={trapRef}
      className="admin-lightbox"
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
      <div className="admin-lightbox-panel" onClick={(event) => event.stopPropagation()}>
        <button className="admin-lightbox-close" type="button" onClick={onClose}>
          Close
        </button>
        <div className="admin-lightbox-stage">
          {previewUrl ? (
            <img src={previewUrl} alt={displayName} />
          ) : (
            <div className="admin-lightbox-loading">Loading preview...</div>
          )}
        </div>
        <div className="admin-lightbox-meta">
          <p className="admin-lightbox-name">{displayName}</p>
          <div className="admin-lightbox-actions">
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
            <button
              className="button ghost"
              type="button"
              onClick={() => onDownload(asset.id)}
            >
              Download
            </button>
          </div>
          <p className="portal-hint">
            {index + 1} / {total}
          </p>
        </div>
      </div>
    </div>
  )
}
