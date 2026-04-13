import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../../lib/queryKeys'
import { apiBaseUrl } from '../../lib/constants'

export type LiveConfig = {
  title: string
  description: string
  isLive: boolean
  updatedAt: string
}

type LiveConfigResponse = {
  config: LiveConfig | null
}

async function fetchLiveConfig(): Promise<LiveConfigResponse> {
  if (!apiBaseUrl) return { config: null }
  const res = await fetch(`${apiBaseUrl}/api/v1/live-config`)
  if (!res.ok) throw new Error('Failed to load live config')
  return res.json() as Promise<LiveConfigResponse>
}

export function useLiveConfig() {
  return useQuery({
    queryKey: queryKeys.liveConfig(),
    queryFn: fetchLiveConfig,
    staleTime: 60_000,
    gcTime: 5 * 60 * 1000,
  })
}
