import { useEffect, useRef, useState } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'

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
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null)
  const [imageKey, setImageKey] = useState(asset.id)

  const displayUrl = previewUrl ?? thumbnailUrl
  const canDownload = Boolean(onDownload && asset.canDownload)
  const hasPrev = index > 0
  const hasNext = index < total - 1

  // Trigger slide animation on asset change
  useEffect(() => {
    if (asset.id !== imageKey) {
      setImageKey(asset.id)
    }
  }, [asset.id, imageKey])

  const handleMove = (direction: 'prev' | 'next') => {
    if (direction === 'prev' && !hasPrev) return
    if (direction === 'next' && !hasNext) return
    setSlideDirection(direction === 'next' ? 'left' : 'right')
    onMove(direction)
  }

  // Clear animation class after transition
  useEffect(() => {
    if (!slideDirection) return
    const timeout = window.setTimeout(() => setSlideDirection(null), 280)
    return () => window.clearTimeout(timeout)
  }, [slideDirection, asset.id])

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
        handleMove('prev')
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        handleMove('next')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  // Click zone handler
  const handleStageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const width = rect.width
    if (x < width * 0.35) {
      handleMove('prev')
    } else if (x > width * 0.65) {
      handleMove('next')
    }
  }

  return (
    <div
      ref={trapRef}
      className="customer-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${index + 1} of ${total}`}
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
          handleMove('next')
        } else {
          handleMove('prev')
        }
      }}
    >
      <div className="customer-lightbox-panel" onClick={(event) => event.stopPropagation()}>
        {/* Close button */}
        <button className="customer-lightbox-close" type="button" onClick={onClose} aria-label="Close">
          ✕
        </button>

        {/* Image stage with click zones */}
        <div
          className={`customer-lightbox-stage ${slideDirection ? `lightbox-slide-${slideDirection}` : ''}`}
          onClick={handleStageClick}
          role="presentation"
        >
          {displayUrl ? (
            <img key={imageKey} src={displayUrl} alt={`Photo ${index + 1} of ${total}`} />
          ) : (
            <div className="customer-lightbox-loading">Loading preview…</div>
          )}

          {/* Side navigation arrows */}
          {hasPrev && (
            <button
              className="lightbox-nav lightbox-nav-prev"
              type="button"
              onClick={(e) => { e.stopPropagation(); handleMove('prev') }}
              aria-label="Previous photo"
            >
              ‹
            </button>
          )}
          {hasNext && (
            <button
              className="lightbox-nav lightbox-nav-next"
              type="button"
              onClick={(e) => { e.stopPropagation(); handleMove('next') }}
              aria-label="Next photo"
            >
              ›
            </button>
          )}
        </div>

        {/* Bottom bar */}
        <div className="customer-lightbox-bar">
          <span className="customer-lightbox-counter">
            {index + 1} / {total}
          </span>
          {onDownload && (
            <button
              className="button ghost"
              type="button"
              disabled={!canDownload}
              onClick={() => onDownload(asset.id)}
            >
              Download
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
