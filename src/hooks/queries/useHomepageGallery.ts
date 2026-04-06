import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../../lib/queryKeys'
import { apiBaseUrl } from '../../lib/constants'

type HomepageGalleryData = {
  categories: {
    landscapes: string[]
    baby: string[]
    portraits: string[]
    events: string[]
  }
}

async function fetchHomepageGallery(): Promise<HomepageGalleryData> {
  if (!apiBaseUrl) {
    // Fallback: return empty categories when no API configured
    return { categories: { landscapes: [], baby: [], portraits: [], events: [] } }
  }
  const res = await fetch(`${apiBaseUrl}/api/v1/homepage/gallery`)
  if (!res.ok) throw new Error('Failed to load gallery')
  return res.json() as Promise<HomepageGalleryData>
}

export function useHomepageGallery() {
  return useQuery({
    queryKey: queryKeys.homepageGallery(),
    queryFn: fetchHomepageGallery,
    staleTime: 5 * 60 * 1000, // 5 min — matches worker Cache-Control
    gcTime: 30 * 60 * 1000,
  })
}
