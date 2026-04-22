import { useEffect, useMemo, useState } from 'react'
import type { ResponsiveAsset, ResponsiveImageProps } from '../types'

const mediaBaseUrl = (import.meta.env.VITE_MEDIA_BASE_URL ?? '').trim().replace(/\/+$/, '')

const localMediaAssetUrls = import.meta.glob(
  '/project-rga/optimized/**/*.{jpg,jpeg,JPG,JPEG,png,PNG,webp,WEBP}',
  {
    eager: true,
    import: 'default',
    query: '?url',
  }
) as Record<string, string>

const normalizeMediaPath = (path: string) => path.replace(/^\/+/, '')

const toRemoteMediaUrl = (path: string) => {
  if (!mediaBaseUrl) return undefined
  if (/^https?:\/\//.test(path)) return path
  return `${mediaBaseUrl}/${normalizeMediaPath(path)}`
}

const toLocalMediaUrl = (path: string) => {
  const key = `/${normalizeMediaPath(path)}`
  return localMediaAssetUrls[key]
}

const buildSrcSet = (variants: Array<{ url?: string; width: number }>) => {
  const srcSet = variants
    .filter((variant): variant is { url: string; width: number } => Boolean(variant.url))
    .map((variant) => `${variant.url} ${variant.width}w`)
    .join(', ')
  return srcSet || undefined
}

const uniqueSources = (sources: Array<{ src?: string; srcSet?: string }>) => {
  const seen = new Set<string>()
  return sources
    .filter((source): source is { src: string; srcSet?: string } => Boolean(source.src))
    .filter((source) => {
      if (seen.has(source.src)) return false
      seen.add(source.src)
      return true
    })
}

// eslint-disable-next-line react-refresh/only-export-components
export const createResponsiveAsset = (originalPath: string): ResponsiveAsset => {
  const normalizedPath = normalizeMediaPath(originalPath)
  const optimizedBase = normalizedPath
    .replace(/^project-rga\//, 'project-rga/optimized/')
    .replace(/\.[^.]+$/, '')

  const remote640 = toRemoteMediaUrl(`${optimizedBase}-640.jpg`)
  const remote1200 = toRemoteMediaUrl(`${optimizedBase}-1200.jpg`)
  const remote1800 = toRemoteMediaUrl(`${optimizedBase}-1800.jpg`)

  const local640 = toLocalMediaUrl(`${optimizedBase}-640.jpg`)
  const local1200 = toLocalMediaUrl(`${optimizedBase}-1200.jpg`)
  const local1800 = toLocalMediaUrl(`${optimizedBase}-1800.jpg`)

  const remoteSrcSet = buildSrcSet([
    { url: remote640, width: 640 },
    { url: remote1200, width: 1200 },
    { url: remote1800, width: 1800 },
  ])

  const localSrcSet = buildSrcSet([
    { url: local640, width: 640 },
    { url: local1200, width: 1200 },
    { url: local1800, width: 1800 },
  ])

  const sources = uniqueSources([
    { src: remote640, srcSet: remoteSrcSet },
    { src: local640, srcSet: localSrcSet },
    { src: remote1200 },
    { src: local1200 },
    { src: remote1800 },
    { src: local1800 },
  ])

  return {
    key: normalizedPath,
    sources,
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export const getPrimaryPreloadSource = (asset: ResponsiveAsset) => asset.sources[0]?.src ?? ''

export const ResponsiveImage = ({
  asset,
  alt,
  className,
  sizes,
  loading = 'lazy',
  fetchPriority = 'auto',
}: ResponsiveImageProps) => {
  const candidates = useMemo(() => asset.sources, [asset.sources])

  const [candidateIndex, setCandidateIndex] = useState(0)

  /* eslint-disable react-hooks/set-state-in-effect -- reset fallback index when asset changes */
  useEffect(() => {
    setCandidateIndex(0)
  }, [asset])
  /* eslint-enable react-hooks/set-state-in-effect */

  const candidate = candidates[Math.min(candidateIndex, Math.max(candidates.length - 1, 0))]
  if (!candidate) return null

  return (
    <img
      className={className}
      src={candidate.src}
      srcSet={candidate.srcSet}
      sizes={candidate.srcSet ? sizes : undefined}
      alt={alt}
      loading={loading}
      fetchPriority={fetchPriority}
      decoding="async"
      onError={() =>
        setCandidateIndex((current) => Math.min(current + 1, Math.max(candidates.length - 1, 0)))
      }
    />
  )
}
