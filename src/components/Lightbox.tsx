import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'

interface LightboxProps {
  /** Unique key for the current image (triggers slide animation on change) */
  imageKey: string
  /** Current 0-based index */
  index: number
  /** Total items */
  total: number
  /** Close handler */
  onClose: () => void
  /** Navigation handler */
  onMove: (direction: 'prev' | 'next') => void
  /** Render the main image area */
  renderImage: (props: { slideClass: string }) => ReactNode
  /** Optional bottom bar content (counter is always shown) */
  bottomBar?: ReactNode
}

export function Lightbox({
  imageKey,
  index,
  total,
  onClose,
  onMove,
  renderImage,
  bottomBar,
}: LightboxProps) {
  const trapRef = useFocusTrap(true)
  const touchStartRef = useRef<number | null>(null)
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null)

  const hasPrev = index > 0
  const hasNext = index < total - 1

  const handleMove = useCallback(
    (direction: 'prev' | 'next') => {
      if (direction === 'prev' && !hasPrev) return
      if (direction === 'next' && !hasNext) return
      setSlideDirection(direction === 'next' ? 'left' : 'right')
      onMove(direction)
    },
    [hasPrev, hasNext, onMove],
  )

  /* Clear slide animation */
  useEffect(() => {
    if (!slideDirection) return
    const timeout = window.setTimeout(() => setSlideDirection(null), 280)
    return () => window.clearTimeout(timeout)
  }, [slideDirection, imageKey])

  /* Keyboard navigation */
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
  }, [onClose, handleMove])

  /* Click zones: left 35% = prev, right 35% = next */
  const handleStageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    if (x < rect.width * 0.35) handleMove('prev')
    else if (x > rect.width * 0.65) handleMove('next')
  }

  const slideClass = slideDirection ? `lightbox-slide-${slideDirection}` : ''

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- dialog backdrop dismiss
    <div
      ref={trapRef}
      className="customer-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${index + 1} of ${total}`}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
      onTouchStart={(e) => {
        touchStartRef.current = e.touches[0]?.clientX ?? null
      }}
      onTouchEnd={(e) => {
        const start = touchStartRef.current
        touchStartRef.current = null
        if (start === null) return
        const delta = (e.changedTouches[0]?.clientX ?? 0) - start
        if (Math.abs(delta) < 48) return
        handleMove(delta < 0 ? 'next' : 'prev')
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- click only stops backdrop-close; keyboard nav is handled globally on window (a panel onKeyDown would swallow arrow keys) */}
      <div
        className="customer-lightbox-panel"
        role="document"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="customer-lightbox-close"
          type="button"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>

        <div
          className={`customer-lightbox-stage ${slideClass}`}
          onClick={handleStageClick}
          role="presentation"
        >
          {renderImage({ slideClass })}

          {hasPrev && (
            <button
              className="lightbox-nav lightbox-nav-prev"
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleMove('prev')
              }}
              aria-label="Previous photo"
            >
              ‹
            </button>
          )}
          {hasNext && (
            <button
              className="lightbox-nav lightbox-nav-next"
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleMove('next')
              }}
              aria-label="Next photo"
            >
              ›
            </button>
          )}
        </div>

        <div className="customer-lightbox-bar">
          <span className="customer-lightbox-counter">
            {index + 1} / {total}
          </span>
          {bottomBar}
        </div>
      </div>
    </div>
  )
}
