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

  const widths = [640, 1200, 1800]
  const remote = widths.map((width) => ({ url: toRemoteMediaUrl(`${optimizedBase}-${width}.jpg`), width }))
  const local = widths.map((width) => ({ url: toLocalMediaUrl(`${optimizedBase}-${width}.jpg`), width }))
  const remoteSrcSet = buildSrcSet(remote)
  const localSrcSet = buildSrcSet(local)

  /* Fallback ladder: remote before local at each width, srcSet on the first pair. */
  const sources = uniqueSources(
    widths.flatMap((_, i) => [
      { src: remote[i].url, ...(i === 0 ? { srcSet: remoteSrcSet } : {}) },
      { src: local[i].url, ...(i === 0 ? { srcSet: localSrcSet } : {}) },
    ]),
  )

  return {
    key: normalizedPath,
    sources,
  }
}

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
