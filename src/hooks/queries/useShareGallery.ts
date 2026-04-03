import { useQuery } from '@tanstack/react-query'
import type { DeliveryAsset, ShareLinkScope } from '../../types'
import { workerRequest } from '../useApi'
import { queryKeys } from '../../lib/queryKeys'

export type ShareGalleryData = {
  deliveryId: string
  scopeType: ShareLinkScope
  allowDownload: boolean
  expiresAt: string
  assets: DeliveryAsset[]
}

export function useShareGallery(token: string | undefined) {
  return useQuery({
    queryKey: queryKeys.shareGallery(token ?? ''),
    queryFn: async () => {
      const payload = await workerRequest<ShareGalleryData>(
        `/api/v1/share-links/${encodeURIComponent(token!)}/gallery`,
        '',
      )

      if (new Date(payload.expiresAt).getTime() <= Date.now()) {
        throw new Error('This share link has expired.')
      }

      return payload
    },
    enabled: !!token,
    staleTime: Infinity,
  })
}
