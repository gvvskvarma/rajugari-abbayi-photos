import { useEffect, useState } from 'react'
import type { ResponsiveAsset } from '../types'
import { getPrimaryPreloadSource, ResponsiveImage } from '../lib/media.tsx'

type RotatingGalleryProps = {
  title: string
  subtitle: string
  images: ResponsiveAsset[]
  cycleStep: number
}

export const RotatingGallery = ({
  title,
  subtitle,
  images,
  cycleStep,
}: RotatingGalleryProps) => {
  const [displayIndex, setDisplayIndex] = useState(0)
  const [incomingIndex, setIncomingIndex] = useState<number | null>(null)
  const [isTransitioning, setIsTransitioning] = useState(false)

  useEffect(() => {
    if (images.length === 0) {
      setDisplayIndex(0)
      setIncomingIndex(null)
      setIsTransitioning(false)
      return
    }
    setDisplayIndex((current) => current % images.length)
  }, [images.length])

  useEffect(() => {
    if (images.length === 0 || isTransitioning || incomingIndex !== null) return
    const nextIndex = cycleStep % images.length
    if (nextIndex === displayIndex) return

    let canceled = false
    const preloadImage = new Image()
    preloadImage.src = getPrimaryPreloadSource(images[nextIndex])

    const beginTransition = () => {
      if (canceled) return
      setIncomingIndex(nextIndex)
      setIsTransitioning(true)
    }

    if (typeof preloadImage.decode === 'function') {
      preloadImage.decode().then(beginTransition).catch(beginTransition)
    } else {
      preloadImage.onload = beginTransition
      preloadImage.onerror = beginTransition
    }

    return () => {
      canceled = true
    }
  }, [cycleStep, displayIndex, images, incomingIndex, isTransitioning])

  useEffect(() => {
    if (!isTransitioning || incomingIndex === null) return
    const timeout = window.setTimeout(() => {
      setDisplayIndex(incomingIndex % images.length)
      setIncomingIndex(null)
      setIsTransitioning(false)
    }, 520)
    return () => window.clearTimeout(timeout)
  }, [images.length, incomingIndex, isTransitioning])

  const active = images.length > 0 ? images[displayIndex % images.length] : undefined
  const incoming =
    incomingIndex !== null && images.length > 0 ? images[incomingIndex % images.length] : undefined

  return (
    <div className="rotator">
      <div className="rotator-card">
        {active ? (
          <div className="rotator-image-stack">
            <ResponsiveImage
              asset={active}
              alt={title}
              className="rotator-image"
              sizes="(max-width: 680px) 92vw, 46vw"
            />
            {incoming && isTransitioning && (
              <ResponsiveImage
                asset={incoming}
                alt={title}
                className="rotator-image rotator-image-enter"
                sizes="(max-width: 680px) 92vw, 46vw"
              />
            )}
          </div>
        ) : (
          <div className="rotator-placeholder">
            <p>Add {title} photos</p>
            <span>Add files to project-rga folders</span>
          </div>
        )}
        <div className="rotator-overlay">
          <p>{title}</p>
          <span>{subtitle}</span>
        </div>
      </div>
    </div>
  )
}
