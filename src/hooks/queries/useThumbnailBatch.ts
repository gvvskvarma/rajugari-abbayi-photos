import { useQuery } from '@tanstack/react-query'
import { workerRequest } from '../useApi'
import { queryKeys } from '../../lib/queryKeys'

export function useThumbnailBatch(
  assetIds: string[],
  options?: { shareToken?: string; variant?: string; getAccessToken?: () => Promise<string> },
) {
  const normalizedAssetIds = [...new Set(assetIds.map((assetId) => assetId.trim()).filter(Boolean))].sort()
  const variant = options?.variant ?? 'thumb'
  const shareToken = options?.shareToken
  const getAccessToken = options?.getAccessToken

  const key = shareToken
    ? queryKeys.shareThumbnailBatch(shareToken, normalizedAssetIds)
    : queryKeys.thumbnailBatch(normalizedAssetIds)

  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const token = getAccessToken ? await getAccessToken() : ''
      const payload = await workerRequest<{ urls: Record<string, string> }>(
        '/api/v1/media/preview-url-batch',
        token,
        {
          method: 'POST',
          body: { assetIds: normalizedAssetIds, variant, ...(shareToken ? { shareToken } : {}) },
        },
      )
      return payload.urls ?? {}
    },
    enabled: normalizedAssetIds.length > 0,
    staleTime: 10 * 60 * 1000,
  })
}
