import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthContext } from './AuthContext'
import { workerRequest } from '../hooks/useApi'
import { useAdminClients } from '../hooks/queries/useAdminClients'
import { queryClient } from '../lib/queryClient'
import { queryKeys } from '../lib/queryKeys'
import type {
  AdminProject,
  AdminAsset,
  AdminClientSummary,
  AdminActivityKind,
  AdminActivityItem,
} from '../types'

type AdminDataContextValue = {
  adminClients: AdminClientSummary[]
  setAdminClients: React.Dispatch<React.SetStateAction<AdminClientSummary[]>>
  adminClientById: Map<string, AdminClientSummary>
  adminProjectById: Map<string, AdminProject>
  adminAssetById: Map<string, AdminAsset>
  loadAdminData: () => Promise<void>
  adminBusy: boolean
  adminError: string
  setAdminError: (msg: string) => void
  adminActionMessage: string
  setAdminActionMessage: (msg: string) => void
  setAdminBusy: (busy: boolean) => void
  recordAdminActivity: (
    kind: AdminActivityKind,
    title: string,
    detail: string,
    context?: {
      clientId?: string | null
      projectId?: string | null
      assetId?: string | null
      metadata?: Record<string, unknown>
    }
  ) => void
}

const AdminDataContext = createContext<AdminDataContextValue | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useAdminData() {
  const ctx = useContext(AdminDataContext)
  if (!ctx) throw new Error('useAdminData must be used within AdminDataProvider')
  return ctx
}

export function AdminDataProvider({ children }: { children: ReactNode }) {
  const { session, role, getAccessToken } = useAuthContext()
  const [adminBusy, setAdminBusy] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [adminActionMessage, setAdminActionMessage] = useState('')

  const userId = session?.user.id
  const { data: adminClients = [], isLoading, error: queryError } = useAdminClients(userId, role)

  const setAdminClients: React.Dispatch<React.SetStateAction<AdminClientSummary[]>> = (action) => {
    const key = queryKeys.adminClients(userId ?? '')
    if (typeof action === 'function') {
      queryClient.setQueryData<AdminClientSummary[]>(key, (prev) => action(prev ?? []))
    } else {
      queryClient.setQueryData<AdminClientSummary[]>(key, action)
    }
  }

  const adminClientById = useMemo(
    () => new Map(adminClients.map((client) => [client.id, client] as const)),
    [adminClients]
  )

  const adminProjectById = useMemo(
    () => new Map(adminClients.flatMap((c) => c.projects).map((p) => [p.id, p] as const)),
    [adminClients]
  )

  const adminAssetById = useMemo(
    () => new Map(adminClients.flatMap((c) => c.assets).map((a) => [a.id, a] as const)),
    [adminClients]
  )

  const loadAdminData = async () => {
    if (!userId || role !== 'admin') return
    await queryClient.invalidateQueries({ queryKey: queryKeys.adminClients(userId) })
  }

  const recordAdminActivity = (
    kind: AdminActivityKind,
    title: string,
    detail: string,
    context?: {
      clientId?: string | null
      projectId?: string | null
      assetId?: string | null
      metadata?: Record<string, unknown>
    }
  ) => {
    if (!supabase || !session?.user.id || role !== 'admin') return

    void (async () => {
      try {
        const token = await getAccessToken()
        if (!token) return

        await workerRequest<{ activity: AdminActivityItem }>(
          '/api/v1/admin/activity',
          token,
          {
            method: 'POST',
            body: {
              kind,
              title,
              detail,
              clientId: context?.clientId ?? null,
              projectId: context?.projectId ?? null,
              assetId: context?.assetId ?? null,
              metadata: context?.metadata ?? {},
            },
          }
        )
      } catch {
        // Audit writes should never block the primary action flow.
      }
    })()
  }

  const combinedBusy = adminBusy || isLoading
  const combinedError = adminError || (queryError instanceof Error ? queryError.message : queryError ? 'Failed to load admin data' : '')

  const value: AdminDataContextValue = {
    adminClients,
    setAdminClients,
    adminClientById,
    adminProjectById,
    adminAssetById,
    loadAdminData,
    adminBusy: combinedBusy,
    adminError: combinedError,
    setAdminError,
    adminActionMessage,
    setAdminActionMessage,
    setAdminBusy,
    recordAdminActivity,
  }

  return <AdminDataContext.Provider value={value}>{children}</AdminDataContext.Provider>
}
