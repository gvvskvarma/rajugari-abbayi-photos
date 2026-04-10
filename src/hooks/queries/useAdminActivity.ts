import { useQuery } from '@tanstack/react-query'
import type { AdminActivityItem } from '../../types'
import { workerRequest } from '../useApi'
import { useAuthContext } from '../../context/AuthContext'
import { queryKeys } from '../../lib/queryKeys'
import { ADMIN_ACTIVITY_LIMIT } from '../../lib/helpers'

export function useAdminActivity(clientId?: string) {
  const { session, role, getAccessToken } = useAuthContext()

  return useQuery({
    queryKey: queryKeys.adminActivity(clientId),
    queryFn: async () => {
      const token = await getAccessToken()
      if (!token) throw new Error('Login session expired. Please log in again.')

      const params = new URLSearchParams({ limit: String(ADMIN_ACTIVITY_LIMIT) })
      if (clientId) params.set('clientId', clientId)

      const payload = await workerRequest<{ activities: AdminActivityItem[] }>(
        `/api/v1/admin/activity?${params.toString()}`,
        token,
      )
      return payload.activities ?? []
    },
    enabled: !!session?.user.id && role === 'admin',
    staleTime: 60_000,
  })
}
