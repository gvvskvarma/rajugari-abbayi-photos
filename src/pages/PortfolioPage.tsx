import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { createResponsiveAsset, ResponsiveImage } from '../lib/media.tsx'
import { fallbackPortraits, fallbackBaby, fallbackEvents, fallbackLandscapes } from '../lib/galleryFallbacks'
import { useHomepageGallery } from '../hooks/queries/useHomepageGallery.ts'
import { useDocumentMeta } from '../hooks/useDocumentMeta.ts'
import { useReveal } from '../hooks/useReveal'
import { Lightbox } from '../components/Lightbox'
import type { ResponsiveAsset } from '../types'

type Category = 'all' | 'portraits' | 'baby' | 'events' | 'landscapes'

const validCategories: Category[] = ['all', 'portraits', 'baby', 'events', 'landscapes']

const categories: { key: Category; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'portraits', label: 'Portraits' },
  { key: 'baby', label: 'Baby Shoots' },
  { key: 'events', label: 'Events' },
  { key: 'landscapes', label: 'Landscapes' },
]

function interleaveAssets(groups: ResponsiveAsset[][]) {
  const maxLength = Math.max(...groups.map((group) => group.length), 0)
  const result: ResponsiveAsset[] = []
  for (let index = 0; index < maxLength; index++) {
    for (const group of groups) {
      const asset = group[index]
      if (asset) result.push(asset)
    }
  }
  return result
}

/* ── Portfolio Page ──────────────────────────────────────────────── */
export function PortfolioPage() {
  useDocumentMeta('Portfolio', 'Curated portraits, baby shoots, events, and landscapes by Rajugari Abbayi Photography.')
  const [searchParams] = useSearchParams()

  /* Read initial tab from ?tab= query param, default to portraits */
  const initialTab = (() => {
    const param = searchParams.get('tab')?.toLowerCase() as Category | undefined
    return param && validCategories.includes(param) ? param : 'portraits'
  })()

  const [activeCategory, setActiveCategory] = useState<Category>(initialTab)
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

  /* Curated "All" view — interleaves categories for variety without randomness */
  const allAssets = useMemo(
    () =>
      interleaveAssets([
        assetsByCategory.portraits,
        assetsByCategory.landscapes,
        assetsByCategory.events,
        assetsByCategory.baby,
      ]),
    [assetsByCategory],
  )

  /* Filtered list based on active tab */
  const filteredAssets = useMemo(() => {
    if (activeCategory === 'all') return allAssets
    return assetsByCategory[activeCategory]
  }, [activeCategory, assetsByCategory, allAssets])

  /* eslint-disable-next-line react-hooks/set-state-in-effect -- close lightbox on category change */
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
        <Lightbox
          imageKey={filteredAssets[lightboxIndex].key}
          index={lightboxIndex}
          total={filteredAssets.length}
          onClose={() => setLightboxIndex(null)}
          onMove={(dir) =>
            setLightboxIndex((prev) => {
              if (prev === null) return null
              return dir === 'next'
                ? Math.min(prev + 1, filteredAssets.length - 1)
                : Math.max(prev - 1, 0)
            })
          }
          renderImage={() => (
            <ResponsiveImage
              key={filteredAssets[lightboxIndex].key}
              asset={filteredAssets[lightboxIndex]}
              alt={`Photo ${lightboxIndex + 1} of ${filteredAssets.length}`}
              sizes="100vw"
              loading="eager"
            />
          )}
        />
      )}
    </>
  )
}
