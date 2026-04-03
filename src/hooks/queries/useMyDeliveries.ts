import { useQuery } from '@tanstack/react-query'
import type { DeliveryCard } from '../../types/models'
import { useAuth } from '../useAuth'
import { workerRequest } from '../useApi'
import { queryKeys } from '../../lib/queryKeys'

export function useMyDeliveries(email: string | undefined) {
  const { getAccessToken } = useAuth()

  return useQuery({
    queryKey: queryKeys.myDeliveries(email ?? ''),
    queryFn: async () => {
      const token = await getAccessToken()
      if (!token) throw new Error('Login session expired. Please log in again.')
      const payload = await workerRequest<{ deliveries: DeliveryCard[] }>(
        '/api/v1/my-pictures',
        token,
      )
      return payload.deliveries ?? []
    },
    enabled: !!email,
    staleTime: 5 * 60 * 1000,
  })
}
