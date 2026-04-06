import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createResponsiveAsset, ResponsiveImage } from '../lib/media.tsx'
import type { ResponsiveAsset } from '../types'
import { useHomepageGallery } from '../hooks/queries/useHomepageGallery.ts'
import { useDocumentMeta } from '../hooks/useDocumentMeta.ts'
import { useFocusTrap } from '../hooks/useFocusTrap.ts'

/* ── Fallback image keys (same as homepage) ─────────────────────── */
const fallbackPortraits = [
  'project-rga/potraits/potraits/RGA04154.jpg',
  'project-rga/potraits/potraits/RGA04156.jpg',
  'project-rga/potraits/potraits/RGA04170-2.jpg',
  'project-rga/potraits/potraits/RGA04174-2.jpg',
  'project-rga/potraits/potraits/RGA04188-2.jpg',
  'project-rga/potraits/potraits/RGA04203-2.jpg',
  'project-rga/potraits/potraits/RGA04280.jpg',
  'project-rga/potraits/potraits/RGA04306-4.jpg',
]
const fallbackBaby = [
  'project-rga/potraits/baby/RGA03628.jpg',
  'project-rga/potraits/baby/RGA03631.jpg',
  'project-rga/potraits/baby/RGA03639.jpg',
  'project-rga/potraits/baby/RGA03656.jpg',
  'project-rga/potraits/baby/RGA03664.jpg',
  'project-rga/potraits/baby/RGA03667.jpg',
]
const fallbackEvents = [
  'project-rga/potraits/events/RGA03248-2.jpg',
  'project-rga/potraits/events/RGA03250.jpg',
  'project-rga/potraits/events/RGA03281.jpg',
  'project-rga/potraits/events/RGA03341.jpg',
  'project-rga/potraits/events/RGA03884.jpg',
  'project-rga/potraits/events/RGA03886.jpg',
  'project-rga/potraits/events/RGA03898.jpg',
  'project-rga/potraits/events/RGA03987.jpg',
  'project-rga/potraits/events/RGA03994.jpg',
  'project-rga/potraits/events/RGA04058.jpg',
  'project-rga/potraits/events/RGA04064.jpg',
  'project-rga/potraits/events/RGA04135.jpg',
  'project-rga/potraits/events/RGA04158.jpg',
  'project-rga/potraits/events/RGA04191.jpg',
  'project-rga/potraits/events/RGA04205.jpg',
]
const fallbackLandscapes = [
  'project-rga/landscapes/RGA02744.jpg',
  'project-rga/landscapes/RGA02755.jpg',
  'project-rga/landscapes/RGA02761.jpg',
  'project-rga/landscapes/RGA02807.jpg',
  'project-rga/landscapes/RGA03800.jpg',
]

type Category = 'all' | 'portraits' | 'baby' | 'events' | 'landscapes'

const categories: { key: Category; label: string }[] = [
  { key: 'portraits', label: 'Portraits' },
  { key: 'baby', label: 'Baby Shoots' },
  { key: 'events', label: 'Events' },
  { key: 'landscapes', label: 'Landscapes' },
  { key: 'all', label: 'All' },
]

/* ── Scroll-reveal hook ─────────────────────────────────────────── */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.classList.add('revealed')
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('revealed')
          observer.disconnect()
        }
      },
      { threshold: 0.08 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return ref
}

/* ── Portfolio Lightbox ─────────────────────────────────────────── */
function PortfolioLightbox({
  assets,
  index,
  onClose,
  onMove,
}: {
  assets: ResponsiveAsset[]
  index: number
  onClose: () => void
  onMove: (direction: 'prev' | 'next') => void
}) {
  const trapRef = useFocusTrap(true)
  const touchStartRef = useRef<number | null>(null)
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null)

  const total = assets.length
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

  useEffect(() => {
    if (!slideDirection) return
    const timeout = window.setTimeout(() => setSlideDirection(null), 280)
    return () => window.clearTimeout(timeout)
  }, [slideDirection, index])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key === 'ArrowLeft') { event.preventDefault(); handleMove('prev') }
      if (event.key === 'ArrowRight') { event.preventDefault(); handleMove('next') }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, handleMove])

  const handleStageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    if (x < rect.width * 0.35) handleMove('prev')
    else if (x > rect.width * 0.65) handleMove('next')
  }

  return (
    <div
      ref={trapRef}
      className="customer-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${index + 1} of ${total}`}
      onClick={onClose}
      onTouchStart={(e) => { touchStartRef.current = e.touches[0]?.clientX ?? null }}
      onTouchEnd={(e) => {
        const start = touchStartRef.current
        touchStartRef.current = null
        if (start === null) return
        const delta = (e.changedTouches[0]?.clientX ?? 0) - start
        if (Math.abs(delta) < 48) return
        handleMove(delta < 0 ? 'next' : 'prev')
      }}
    >
      <div className="customer-lightbox-panel" onClick={(e) => e.stopPropagation()}>
        <button className="customer-lightbox-close" type="button" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <div
          className={`customer-lightbox-stage ${slideDirection ? `lightbox-slide-${slideDirection}` : ''}`}
          onClick={handleStageClick}
          role="presentation"
        >
          <ResponsiveImage
            key={assets[index].key}
            asset={assets[index]}
            alt={`Photo ${index + 1} of ${total}`}
            sizes="100vw"
            loading="eager"
          />
          {hasPrev && (
            <button className="lightbox-nav lightbox-nav-prev" type="button" onClick={(e) => { e.stopPropagation(); handleMove('prev') }} aria-label="Previous photo">
              ‹
            </button>
          )}
          {hasNext && (
            <button className="lightbox-nav lightbox-nav-next" type="button" onClick={(e) => { e.stopPropagation(); handleMove('next') }} aria-label="Next photo">
              ›
            </button>
          )}
        </div>
        <div className="customer-lightbox-bar">
          <span className="customer-lightbox-counter">{index + 1} / {total}</span>
        </div>
      </div>
    </div>
  )
}

/* ── Portfolio Page ──────────────────────────────────────────────── */
export function PortfolioPage() {
  useDocumentMeta('Portfolio', 'Curated portraits, baby shoots, events, and landscapes by Rajugari Abbayi Photography.')
  const [activeCategory, setActiveCategory] = useState<Category>('portraits')
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const { data: galleryData } = useHomepageGallery()

  const heroRef = useReveal<HTMLElement>()
  const gridRef = useReveal<HTMLElement>()

  /* Build categorized asset maps */
  const assetsByCategory = useMemo(() => {
    const cats = galleryData?.categories
    return {
      portraits: (cats?.portraits?.length ? cats.portraits : fallbackPortraits).map(createResponsiveAsset),
      baby: (cats?.baby?.length ? cats.baby : fallbackBaby).map(createResponsiveAsset),
      events: (cats?.events?.length ? cats.events : fallbackEvents).map(createResponsiveAsset),
      landscapes: (cats?.landscapes?.length ? cats.landscapes : fallbackLandscapes).map(createResponsiveAsset),
    }
  }, [galleryData])

  /* Shuffled mix for "All" — stable per render cycle */
  const shuffledAll = useMemo(() => {
    const all = [
      ...assetsByCategory.portraits,
      ...assetsByCategory.baby,
      ...assetsByCategory.events,
      ...assetsByCategory.landscapes,
    ]
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]]
    }
    return all
  }, [assetsByCategory])

  /* Filtered list based on active tab */
  const filteredAssets = useMemo(() => {
    if (activeCategory === 'all') return shuffledAll
    return assetsByCategory[activeCategory]
  }, [activeCategory, assetsByCategory, shuffledAll])

  /* Close lightbox on category change */
  useEffect(() => setLightboxIndex(null), [activeCategory])

  return (
    <>
      {/* ── HERO ── */}
      <section className="portfolio-hero reveal-section" ref={heroRef}>
        <p className="eyebrow">Portfolio</p>
        <h1>Stories I've told</h1>
        <p className="lead">
          A curated look at the portraits, celebrations, and quiet moments I've
          had the privilege of capturing.
        </p>
      </section>

      {/* ── FILTER + GRID ── */}
      <section className="portfolio-gallery reveal-section" ref={gridRef}>
        {/* Category pills */}
        <div className="portfolio-filters">
          {categories.map((cat) => (
            <button
              key={cat.key}
              type="button"
              className={`portfolio-filter-pill ${activeCategory === cat.key ? 'is-active' : ''}`}
              onClick={() => setActiveCategory(cat.key)}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Image grid */}
        <div className="portfolio-grid">
          {filteredAssets.map((asset, idx) => (
            <button
              key={asset.key}
              type="button"
              className="portfolio-thumb"
              onClick={() => setLightboxIndex(idx)}
              aria-label={`View photo ${idx + 1}`}
            >
              <ResponsiveImage
                asset={asset}
                alt=""
                className="portfolio-thumb-img"
                sizes="(min-width: 980px) 33vw, (min-width: 680px) 50vw, 100vw"
                loading={idx < 6 ? 'eager' : 'lazy'}
              />
            </button>
          ))}
        </div>
      </section>

      {/* ── LIGHTBOX ── */}
      {lightboxIndex !== null && (
        <PortfolioLightbox
          assets={filteredAssets}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onMove={(dir) =>
            setLightboxIndex((prev) => {
              if (prev === null) return null
              return dir === 'next'
                ? Math.min(prev + 1, filteredAssets.length - 1)
                : Math.max(prev - 1, 0)
            })
          }
        />
      )}
    </>
  )
}
