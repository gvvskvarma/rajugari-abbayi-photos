import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthContext } from '../../context/AuthContext'
import { workerRequest } from '../useApi'
import { queryKeys } from '../../lib/queryKeys'

export type ClientDelivery = {
  deliveryId: string
  title: string
  status: string
  expiresAt: string | null
  expiredAt: string | null
  purgedAt: string | null
  sharedAt: string | null
  createdAt: string
  assetCount: number
}

/**
 * Fetches a client's deliveries with retention info and exposes an
 * "extend retention" mutation. Powers the admin Retention panel.
 */
export function useClientDeliveries(clientId: string | undefined) {
  const { role, getAccessToken } = useAuthContext()
  const queryClient = useQueryClient()
  const enabled = Boolean(clientId) && role === 'admin'

  const query = useQuery({
    queryKey: queryKeys.adminClientDeliveries(clientId ?? ''),
    enabled,
    queryFn: async () => {
      const token = await getAccessToken()
      if (!token) throw new Error('Not authenticated')
      const data = await workerRequest<{ deliveries: ClientDelivery[] }>(
        `/api/v1/admin/clients/${clientId}/deliveries`,
        token,
      )
      return data.deliveries
    },
  })

  const extend = useMutation({
    mutationFn: async (deliveryId: string) => {
      const token = await getAccessToken()
      if (!token) throw new Error('Not authenticated')
      return workerRequest<{ ok: boolean; expiresAt: string }>(
        `/api/v1/admin/deliveries/${deliveryId}/extend`,
        token,
        { method: 'POST', body: {} },
      )
    },
    onSuccess: () => {
      if (clientId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.adminClientDeliveries(clientId) })
      }
    },
  })

  return { ...query, extend }
}
