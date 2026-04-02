import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { workerRequest } from '../hooks/useApi'
import type {
  AdminClient,
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

export function useAdminData() {
  const ctx = useContext(AdminDataContext)
  if (!ctx) throw new Error('useAdminData must be used within AdminDataProvider')
  return ctx
}

export function AdminDataProvider({ children }: { children: ReactNode }) {
  const { session, role, getAccessToken } = useAuth()
  const [adminClients, setAdminClients] = useState<AdminClientSummary[]>([])
  const [adminBusy, setAdminBusy] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [adminActionMessage, setAdminActionMessage] = useState('')

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
    if (!supabase || !session?.user.id || role !== 'admin') return

    setAdminBusy(true)
    setAdminError('')

    try {
      const [clientsResult, projectsResult, assetsResult] = await Promise.all([
        supabase
          .from('clients')
          .select('id, full_name, email, phone, notes, created_at, updated_at')
          .eq('owner_user_id', session.user.id)
          .order('updated_at', { ascending: false }),
        supabase
          .from('projects')
          .select('id, client_id, name, description, shoot_date, location, status, created_at, updated_at')
          .eq('owner_user_id', session.user.id)
          .order('updated_at', { ascending: false }),
        supabase
          .from('assets')
          .select('id, project_id, delivery_id, filename, mime_type, bytes, r2_object_key, created_at')
          .eq('owner_user_id', session.user.id)
          .order('created_at', { ascending: false }),
      ])

      if (clientsResult.error) throw clientsResult.error
      if (projectsResult.error) throw projectsResult.error
      if (assetsResult.error) throw assetsResult.error

      const clients = (clientsResult.data ?? []) as AdminClient[]
      const projects = (projectsResult.data ?? []) as AdminProject[]
      const assets = (assetsResult.data ?? []) as AdminAsset[]

      const projectsByClient = new Map<string, AdminProject[]>()
      for (const project of projects) {
        const current = projectsByClient.get(project.client_id) ?? []
        current.push(project)
        projectsByClient.set(project.client_id, current)
      }

      const assetsByProject = new Map<string, AdminAsset[]>()
      for (const asset of assets) {
        const current = assetsByProject.get(asset.project_id) ?? []
        current.push(asset)
        assetsByProject.set(asset.project_id, current)
      }

      const summaries: AdminClientSummary[] = clients.map((clientRow) => {
        const clientProjects = projectsByClient.get(clientRow.id) ?? []
        const clientAssets = clientProjects.flatMap((project) => assetsByProject.get(project.id) ?? [])
        const latestUpdatedAt =
          [clientRow.updated_at, ...clientProjects.map((p) => p.updated_at), ...clientAssets.map((a) => a.created_at)]
            .sort((l, r) => new Date(r).getTime() - new Date(l).getTime())[0] ?? clientRow.updated_at

        return {
          ...clientRow,
          projects: clientProjects,
          assets: clientAssets,
          projectCount: clientProjects.length,
          assetCount: clientAssets.length,
          latestUpdatedAt,
        }
      })

      setAdminClients(summaries)
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Failed to load admin data')
    } finally {
      setAdminBusy(false)
    }
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

  useEffect(() => {
    if (!supabase || !session?.user.id || role !== 'admin') return
    void loadAdminData()
  }, [role, session?.user.id])

  const value: AdminDataContextValue = {
    adminClients,
    setAdminClients,
    adminClientById,
    adminProjectById,
    adminAssetById,
    loadAdminData,
    adminBusy,
    adminError,
    setAdminError,
    adminActionMessage,
    setAdminActionMessage,
    setAdminBusy,
    recordAdminActivity,
  }

  return <AdminDataContext.Provider value={value}>{children}</AdminDataContext.Provider>
}
