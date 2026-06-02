import { useQuery } from '@tanstack/react-query'
import type { AdminClient, AdminProject, AdminAsset, AdminClientSummary } from '../../types'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'

export function useAdminClients(userId: string | undefined, role: string) {
  return useQuery({
    queryKey: queryKeys.adminClients(userId ?? ''),
    queryFn: async () => {
      if (!supabase || !userId) throw new Error('Not authenticated')

      const [clientsResult, projectsResult, assetsResult] = await Promise.all([
        supabase
          .from('clients')
          .select('id, full_name, email, phone, notes, created_at, updated_at')
          .eq('owner_user_id', userId)
          .order('updated_at', { ascending: false }),
        supabase
          .from('projects')
          .select('id, client_id, name, description, shoot_date, location, status, created_at, updated_at')
          .eq('owner_user_id', userId)
          .order('updated_at', { ascending: false }),
        supabase
          .from('assets')
          .select('id, project_id, delivery_id, filename, mime_type, bytes, r2_object_key, created_at, folder')
          .eq('owner_user_id', userId)
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

      return summaries
    },
    enabled: !!supabase && !!userId && role === 'admin',
    staleTime: 30_000,
  })
}
