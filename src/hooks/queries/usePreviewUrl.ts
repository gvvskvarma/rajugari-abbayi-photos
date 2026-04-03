import { useQuery } from '@tanstack/react-query'
import { workerRequest } from '../useApi'
import { queryKeys } from '../../lib/queryKeys'

export function usePreviewUrl(
  assetId: string,
  options?: { shareToken?: string; getAccessToken?: () => Promise<string> },
) {
  const shareToken = options?.shareToken
  const getAccessToken = options?.getAccessToken

  const key = shareToken
    ? queryKeys.sharePreviewUrl(shareToken, assetId)
    : queryKeys.previewUrl(assetId)

  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const token = getAccessToken ? await getAccessToken() : ''
      const endpoint = shareToken ? '/api/v1/media/signed-url' : '/api/v1/media/preview-url'
      const payload = await workerRequest<{ signedUrl?: string; url?: string }>(
        endpoint,
        token,
        {
          method: 'POST',
          body: { assetId, mode: 'view', ...(shareToken ? { shareToken } : {}) },
        },
      )
      return payload.url ?? payload.signedUrl ?? null
    },
    enabled: !!assetId,
    staleTime: 10 * 60 * 1000,
  })
}
