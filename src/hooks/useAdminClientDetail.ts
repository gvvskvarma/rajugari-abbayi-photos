import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import type {
  AdminActivityItem,
  AdminActivityKind,
  AdminClient,
  AdminLightboxState,
  AdminProject,
  AdminProjectView,
  DeleteConfirmationState,
} from '../types'
import { useAuthContext } from '../context/AuthContext'
import { workerRequest, loadWorkerBlob, triggerBrowserDownload } from './useApi'
import { apiBaseUrl } from '../lib/constants'
import { useAdminData } from '../context/AdminDataContext.tsx'
import { useAdminActivity } from './queries/useAdminActivity'
import { supabase } from '../lib/supabase'
import { ADMIN_PROJECT_CHUNK_SIZE, getAssetKind } from '../lib/helpers'
import { getDisplayFileName, sanitizeDownloadName } from '../lib/upload'
import { splitIntoDownloadParts } from '../lib/downloadParts'
import { queryClient } from '../lib/queryClient'
import { queryKeys } from '../lib/queryKeys'

export function useAdminClientDetail() {
  const { clientId } = useParams<{ clientId: string }>()
  const navigate = useNavigate()
  const { session, role, getAccessToken } = useAuthContext()
  const {
    adminClients,
    setAdminClients,
    adminClientById,
    adminProjectById,
    adminAssetById,
    loadAdminData,
    recordAdminActivity,
    adminBusy,
    adminError,
    setAdminError,
    adminActionMessage,
    setAdminActionMessage,
    setAdminBusy,
  } = useAdminData()

  // --- local state ---
  const [adminClientEditMode, setAdminClientEditMode] = useState(false)
  const [adminClientDraft, setAdminClientDraft] = useState({
    fullName: '',
    email: '',
    phone: '',
    notes: '',
  })
  const [adminAssetSearch, setAdminAssetSearch] = useState('')
  const [adminProjectSort, setAdminProjectSort] = useState<'recent' | 'name' | 'files'>('recent')
  const [adminAssetTypeFilter, setAdminAssetTypeFilter] = useState<'all' | 'images' | 'videos' | 'other'>('all')
  const [adminProjectFilterId, setAdminProjectFilterId] = useState('all')
  const [selectedAdminAssetIds, setSelectedAdminAssetIds] = useState<string[]>([])
  const [adminAssetPreviewUrls, setAdminAssetPreviewUrls] = useState<Record<string, string>>({})
  const [adminProjectRenderLimits, setAdminProjectRenderLimits] = useState<Record<string, number>>({})
  const [adminLightbox, setAdminLightbox] = useState<AdminLightboxState | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmationState | null>(null)

  // --- activity via TanStack Query ---
  const [kindFilter, setKindFilter] = useState<'all' | AdminActivityKind>('all')
  const [activityExpanded, setActivityExpanded] = useState(false)
  const { data: activities = [], isLoading: activityBusy, error: activityError } = useAdminActivity(clientId)

  // --- computed ---
  const selectedAdminClient = useMemo(
    () => adminClients.find((client) => client.id === clientId) ?? null,
    [adminClients, clientId]
  )

  const selectedAdminClientProjectViews = useMemo<AdminProjectView[]>(() => {
    if (!selectedAdminClient) return []

    const query = adminAssetSearch.trim().toLowerCase()
    const projectViews = selectedAdminClient.projects
      .filter((project) => adminProjectFilterId === 'all' || project.id === adminProjectFilterId)
      .map((project) => {
        const projectAssets = selectedAdminClient.assets.filter((asset) => asset.project_id === project.id)
        const filteredAssets = projectAssets.filter((asset) => {
          const searchMatch =
            !query ||
            [asset.filename, asset.mime_type, project.name].join(' ').toLowerCase().includes(query)
          const typeMatch =
            adminAssetTypeFilter === 'all' || getAssetKind(asset.mime_type) === adminAssetTypeFilter
          return searchMatch && typeMatch
        })
        const renderLimit = adminProjectRenderLimits[project.id] ?? ADMIN_PROJECT_CHUNK_SIZE
        const visibleAssets = filteredAssets.slice(0, renderLimit)
        const latestActivityAt =
          [project.updated_at, ...projectAssets.map((asset) => asset.created_at)]
            .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? project.updated_at

        return { project, totalAssets: filteredAssets.length, visibleAssets, latestActivityAt }
      })

    projectViews.sort((left, right) => {
      if (adminProjectSort === 'name') return left.project.name.localeCompare(right.project.name)
      if (adminProjectSort === 'files') return right.totalAssets - left.totalAssets
      return new Date(right.latestActivityAt).getTime() - new Date(left.latestActivityAt).getTime()
    })

    return projectViews
  }, [adminAssetSearch, adminAssetTypeFilter, adminProjectFilterId, adminProjectRenderLimits, adminProjectSort, selectedAdminClient])

  const selectedAdminVisibleAssets = useMemo(
    () => selectedAdminClientProjectViews.flatMap((entry) => entry.visibleAssets),
    [selectedAdminClientProjectViews]
  )

  const adminLightboxAssets = useMemo(() => {
    if (!adminLightbox) return []
    const project = selectedAdminClientProjectViews.find((entry) => entry.project.id === adminLightbox.projectId)
    return (project?.visibleAssets ?? []).filter((asset) => asset.mime_type.startsWith('image/'))
  }, [adminLightbox, selectedAdminClientProjectViews])

  const adminLightboxIndex = useMemo(() => {
    if (!adminLightbox) return -1
    return adminLightboxAssets.findIndex((asset) => asset.id === adminLightbox.assetId)
  }, [adminLightbox, adminLightboxAssets])

  const adminLightboxAsset = adminLightboxIndex >= 0 ? adminLightboxAssets[adminLightboxIndex] : null

  // --- effects ---

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!selectedAdminClient) {
      setAdminClientEditMode(false)
      setAdminClientDraft({ fullName: '', email: '', phone: '', notes: '' })
      return
    }
    setAdminClientDraft({
      fullName: selectedAdminClient.full_name,
      email: selectedAdminClient.email,
      phone: selectedAdminClient.phone ?? '',
      notes: selectedAdminClient.notes ?? '',
    })
  }, [selectedAdminClient?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSelectedAdminAssetIds((current) =>
      current.filter((assetId) => selectedAdminVisibleAssets.some((asset) => asset.id === assetId))
    )
  }, [selectedAdminVisibleAssets])

  useEffect(() => {
    if (adminProjectFilterId === 'all') return
    if (!selectedAdminClient?.projects.some((project) => project.id === adminProjectFilterId)) {
      setAdminProjectFilterId('all')
    }
  }, [adminProjectFilterId, selectedAdminClient])

  useEffect(() => {
    setAdminProjectRenderLimits({})
  }, [selectedAdminClient?.id])

  useEffect(() => {
    if (!adminLightbox) return
    if (adminLightboxAssets.length === 0) { setAdminLightbox(null); return }
    if (adminLightboxIndex === -1) {
      setAdminLightbox({ projectId: adminLightbox.projectId, assetId: adminLightboxAssets[0].id })
    }
  }, [adminLightbox, adminLightboxAssets, adminLightboxIndex])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!supabase || !session?.user.id || role !== 'admin' || selectedAdminVisibleAssets.length === 0) return
    const missingPreviewAssets = selectedAdminVisibleAssets.filter(
      (asset) => asset.mime_type.startsWith('image/') && !adminAssetPreviewUrls[asset.id]
    )
    if (missingPreviewAssets.length === 0) return
    let cancelled = false
    const loadPreviewUrls = async () => {
      const token = await getAccessToken()
      if (!token) return
      const payload = await workerRequest<{ urls: Record<string, string> }>(
        '/api/v1/media/preview-url-batch', token,
        { method: 'POST', body: { assetIds: missingPreviewAssets.map((asset) => asset.id), variant: 'preview' } }
      )
      if (cancelled) return
      setAdminAssetPreviewUrls((current) => ({ ...current, ...(payload.urls ?? {}) }))
    }
    void loadPreviewUrls()
    return () => { cancelled = true }
  }, [adminAssetPreviewUrls, getAccessToken, role, selectedAdminVisibleAssets, session?.user.id])

  // --- mutations ---

  const saveClientMutation = useMutation({
    mutationFn: async (draft: { fullName: string; email: string; phone: string; notes: string }) => {
      if (!selectedAdminClient) throw new Error('No client selected')
      const token = await getAccessToken()
      if (!token) throw new Error('Login session expired. Please log in again.')
      return workerRequest<{ client: AdminClient }>(
        `/api/v1/admin/clients/${selectedAdminClient.id}`, token,
        { method: 'PATCH', body: { fullName: draft.fullName, email: draft.email, phone: draft.phone, notes: draft.notes } }
      )
    },
    onSuccess: (data) => {
      setAdminClients((current) =>
        current.map((client) => (client.id === data.client.id ? { ...client, ...data.client } : client))
      )
      setAdminClientEditMode(false)
      recordAdminActivity('edit', 'Updated client', data.client.full_name, { clientId: data.client.id })
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminActivity(clientId) })
    },
    onError: (error) => {
      setAdminError(error instanceof Error ? error.message : 'Unable to update client')
    },
  })

  // --- handlers ---

  const openAdminLightbox = async (projectId: string, assetId: string) => {
    const asset = selectedAdminClientProjectViews
      .find((entry) => entry.project.id === projectId)
      ?.visibleAssets.find((entry) => entry.id === assetId)
    if (!asset || !asset.mime_type.startsWith('image/')) return
    setAdminLightbox({ projectId, assetId })
    if (adminAssetPreviewUrls[asset.id]) return
    try {
      const token = await getAccessToken()
      if (!token) return
      const payload = await workerRequest<{ url: string }>('/api/v1/media/preview-url', token, {
        method: 'POST', body: { assetId: asset.id },
      })
      setAdminAssetPreviewUrls((current) => ({ ...current, [asset.id]: payload.url }))
    } catch { /* lightbox can still open */ }
  }

  const closeAdminLightbox = () => setAdminLightbox(null)

  const moveAdminLightbox = (direction: 'prev' | 'next') => {
    const currentLightbox = adminLightbox
    if (!currentLightbox || !adminLightboxAsset || adminLightboxIndex < 0) return
    const nextIndex = direction === 'next' ? adminLightboxIndex + 1 : adminLightboxIndex - 1
    if (nextIndex < 0 || nextIndex >= adminLightboxAssets.length) return
    setAdminLightbox({ projectId: currentLightbox.projectId, assetId: adminLightboxAssets[nextIndex].id })
  }

  const toggleSelectedAdminAsset = (assetId: string) => {
    setSelectedAdminAssetIds((current) =>
      current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId]
    )
  }

  const clearSelectedAdminAssets = () => setSelectedAdminAssetIds([])

  const selectVisibleAdminAssets = () =>
    setSelectedAdminAssetIds((current) => {
      const next = new Set(current)
      selectedAdminVisibleAssets.forEach((asset) => next.add(asset.id))
      return [...next]
    })

  const loadMoreAdminProjectAssets = (projectId: string) => {
    setAdminProjectRenderLimits((current) => ({
      ...current,
      [projectId]: (current[projectId] ?? ADMIN_PROJECT_CHUNK_SIZE) + ADMIN_PROJECT_CHUNK_SIZE,
    }))
  }

  const handleOpenAsset = async (assetId: string, mode: 'view' | 'download') => {
    if (!supabase) return
    try {
      const token = await getAccessToken()
      if (!token) { setAdminError('Login session expired. Please log in again.'); return }
      const endpoint = mode === 'view' ? '/api/v1/media/preview-url' : '/api/v1/media/signed-url'
      const payload = await workerRequest<{ signedUrl?: string; url?: string }>(endpoint, token, {
        method: 'POST', body: { assetId, mode },
      })
      const nextUrl = payload.url ?? payload.signedUrl
      if (!nextUrl) throw new Error('Missing asset URL')
      window.open(nextUrl, '_blank', 'noopener,noreferrer')
      if (mode === 'download') {
        const adminAsset = selectedAdminClient?.assets.find((entry) => entry.id === assetId)
        recordAdminActivity('download', 'Downloaded file', getDisplayFileName(adminAsset?.filename ?? assetId), {
          clientId: selectedAdminClient?.id ?? null, projectId: adminAsset?.project_id ?? null, assetId,
        })
      }
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Unable to open file')
    }
  }

  const downloadAdminArchive = async (
    path: string, body: unknown, filename: string,
    activity?: {
      kind: AdminActivityKind; title: string; detail: string
      context?: { clientId?: string | null; projectId?: string | null; assetId?: string | null; metadata?: Record<string, unknown> }
    }
  ) => {
    if (!supabase) return
    try {
      setAdminActionMessage(`Preparing ${filename}...`)
      setAdminBusy(true)
      const token = await getAccessToken()
      if (!token) { setAdminError('Login session expired. Please log in again.'); return }
      const blob = await loadWorkerBlob(path, token, { method: 'POST', body })
      triggerBrowserDownload(blob, filename)
      if (activity) recordAdminActivity(activity.kind, activity.title, activity.detail, activity.context)
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Unable to download files')
    } finally {
      setAdminBusy(false)
      setAdminActionMessage('')
    }
  }

  /* Download an asset set, auto-split into ~1.5GB parts so large folders stay
     under the Free-plan per-request limits. Parts download sequentially (the
     browser may ask to allow multiple files — that's expected). */
  const downloadAdminInParts = async (
    assets: Array<{ id: string; bytes: number }>,
    baseName: string,
    activity: { kind: AdminActivityKind; title: string; detail: string; context?: Record<string, unknown> },
  ) => {
    const parts = splitIntoDownloadParts(assets)
    const safeBase = sanitizeDownloadName(baseName)
    for (const part of parts) {
      const filename = parts.length > 1
        ? `${safeBase}-part-${part.index}-of-${part.total}.zip`
        : `${safeBase}.zip`
      await downloadAdminArchive(
        '/api/v1/admin/downloads',
        { assetIds: part.assetIds, filename: baseName },
        filename,
        part.index === 1
          ? { kind: activity.kind, title: activity.title, detail: parts.length > 1 ? `${activity.detail} (${parts.length} parts)` : activity.detail, context: activity.context }
          : undefined,
      )
    }
  }

  /* Native download of a whole project (folder): mint a signed token, then
     navigate the browser to the GET URL so it streams the zip straight to
     disk — single zip, any size, no in-memory buffering. */
  const handleDownloadAdminProject = async (project: AdminProject) => {
    if (!supabase || !session?.user.id || role !== 'admin') return
    const count = selectedAdminClient?.assets.filter((a) => a.project_id === project.id).length ?? 0
    if (count === 0) { setAdminError('No files found for this folder.'); return }
    try {
      setAdminBusy(true)
      setAdminActionMessage(`Preparing ${project.name}...`)
      const token = await getAccessToken()
      if (!token) { setAdminError('Login session expired. Please log in again.'); return }
      const { path } = await workerRequest<{ token: string; path: string }>(
        '/api/v1/admin/downloads/token', token,
        { method: 'POST', body: { projectId: project.id, filename: project.name } },
      )
      recordAdminActivity('download', 'Downloaded folder', project.name, {
        clientId: selectedAdminClient?.id ?? null, projectId: project.id, metadata: { count },
      })
      window.location.href = `${apiBaseUrl}${path}`
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Unable to download files')
    } finally {
      setAdminBusy(false)
      setAdminActionMessage('')
    }
  }

  const handleDownloadSelectedAdminAssets = async () => {
    if (!supabase || !session?.user.id || role !== 'admin' || selectedAdminAssetIds.length === 0) return
    const clientName = selectedAdminClient?.full_name ?? 'selected-files'
    const selectedSet = new Set(selectedAdminAssetIds)
    const selectedAssets = selectedAdminClient?.assets
      .filter((asset) => selectedSet.has(asset.id))
      .map((asset) => ({ id: asset.id, bytes: asset.bytes })) ?? []
    await downloadAdminInParts(selectedAssets, `${clientName}-selected`, {
      kind: 'download', title: 'Downloaded selection',
      detail: `${selectedAdminAssetIds.length} selected files from ${clientName}`,
      context: { clientId: selectedAdminClient?.id ?? null, metadata: { count: selectedAdminAssetIds.length, assetIds: selectedAdminAssetIds } },
    })
  }

  const performDeleteAdminAsset = async (
    assetId: string, label?: string,
    context?: { clientId?: string | null; projectId?: string | null; assetId?: string | null; metadata?: Record<string, unknown> },
    options?: { silent?: boolean }
  ) => {
    if (!supabase || !session?.user.id || role !== 'admin') return
    const token = await getAccessToken()
    if (!token) { setAdminError('Login session expired. Please log in again.'); return }
    await workerRequest<{ ok: boolean }>(`/api/v1/admin/assets/${assetId}`, token, { method: 'DELETE' })
    setAdminClients((current) =>
      current.map((client) => {
        const nextAssets = client.assets.filter((asset) => asset.id !== assetId)
        return { ...client, assets: nextAssets, assetCount: nextAssets.length }
      })
    )
    setSelectedAdminAssetIds((current) => current.filter((id) => id !== assetId))
    if (adminLightbox?.assetId === assetId) closeAdminLightbox()
    if (!options?.silent) {
      recordAdminActivity('delete', 'Deleted file', `Removed ${label ?? assetId}`, {
        clientId: context?.clientId ?? selectedAdminClient?.id ?? null,
        projectId: context?.projectId ?? null, assetId: context?.assetId ?? assetId, metadata: context?.metadata,
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminActivity(clientId) })
    }
  }

  const performDeleteAdminAssets = async (assetIds: string[]) => {
    for (const assetId of assetIds) await performDeleteAdminAsset(assetId, undefined, undefined, { silent: true })
    recordAdminActivity('delete', `Deleted ${assetIds.length} file${assetIds.length === 1 ? '' : 's'}`,
      'Removed selected files from the admin folder',
      { clientId: selectedAdminClient?.id ?? null, metadata: { count: assetIds.length, assetIds } })
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminActivity(clientId) })
  }

  const performDeleteAdminProject = async (projectId: string, label?: string) => {
    if (!supabase || !session?.user.id || role !== 'admin') return
    const token = await getAccessToken()
    if (!token) { setAdminError('Login session expired. Please log in again.'); return }
    await workerRequest<{ ok: boolean }>(`/api/v1/admin/projects/${projectId}`, token, { method: 'DELETE' })
    await loadAdminData()
    setSelectedAdminAssetIds([])
    if (adminLightbox?.projectId === projectId) closeAdminLightbox()
    recordAdminActivity('delete', 'Deleted folder', `Removed ${label ?? projectId}`, { clientId: selectedAdminClient?.id ?? null, projectId })
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminActivity(clientId) })
  }

  const performDeleteAdminClient = async (deleteClientId: string, label?: string) => {
    if (!supabase || !session?.user.id || role !== 'admin') return
    const token = await getAccessToken()
    if (!token) { setAdminError('Login session expired. Please log in again.'); return }
    await workerRequest<{ ok: boolean }>(`/api/v1/admin/clients/${deleteClientId}`, token, { method: 'DELETE' })
    setAdminClients((current) => current.filter((client) => client.id !== deleteClientId))
    setAdminClientEditMode(false)
    setAdminAssetSearch('')
    setSelectedAdminAssetIds([])
    closeAdminLightbox()
    navigate('/admin/clients')
    recordAdminActivity('delete', 'Deleted client', `Removed ${label ?? deleteClientId}`, { clientId: deleteClientId })
  }

  const openDeleteConfirmation = (payload: DeleteConfirmationState) => setDeleteConfirmation(payload)
  const closeDeleteConfirmation = () => setDeleteConfirmation(null)

  const confirmDeleteConfirmation = async () => {
    const current = deleteConfirmation
    if (!current) return
    setDeleteConfirmation(null)
    setAdminActionMessage(current.progressLabel)
    setAdminBusy(true)
    setAdminError('')
    try { await current.onConfirm() }
    catch (error) { setAdminError(error instanceof Error ? error.message : 'Unable to complete delete') }
    finally { setAdminBusy(false); setAdminActionMessage('') }
  }

  const handleDeleteAdminAsset = (assetId: string) => {
    if (!supabase || !session?.user.id || role !== 'admin' || !selectedAdminClient) return
    const asset = selectedAdminVisibleAssets.find((entry) => entry.id === assetId)
      ?? selectedAdminClient.assets.find((entry) => entry.id === assetId)
    if (!asset) { setAdminError('File not found.'); return }
    openDeleteConfirmation({
      title: `Delete ${getDisplayFileName(asset.filename)}?`,
      description: 'This permanently removes the file from the folder, customer view, and database.',
      confirmLabel: 'Delete file', progressLabel: 'Deleting file...',
      onConfirm: () => performDeleteAdminAsset(assetId, getDisplayFileName(asset.filename), {
        clientId: selectedAdminClient.id, projectId: asset.project_id, assetId: asset.id,
      }),
    })
  }

  const handleDeleteAdminProject = (project: AdminProject) => {
    if (!supabase || !session?.user.id || role !== 'admin') return
    openDeleteConfirmation({
      title: `Delete folder ${project.name}?`,
      description: 'This removes the project, its uploaded files, the customer folder data, and the database records.',
      confirmLabel: 'Delete folder', progressLabel: 'Deleting folder...',
      onConfirm: () => performDeleteAdminProject(project.id, project.name),
    })
  }

  const handleBulkDeleteAdminAssets = () => {
    if (!supabase || !session?.user.id || role !== 'admin' || selectedAdminAssetIds.length === 0) return
    const assetIds = [...selectedAdminAssetIds]
    openDeleteConfirmation({
      title: `Delete ${assetIds.length} selected file${assetIds.length === 1 ? '' : 's'}?`,
      description: 'This permanently removes the files from the folder, customer view, and database.',
      confirmLabel: 'Delete selected',
      progressLabel: `Deleting ${assetIds.length} selected file${assetIds.length === 1 ? '' : 's'}...`,
      onConfirm: async () => { await performDeleteAdminAssets(assetIds); setSelectedAdminAssetIds([]) },
    })
  }

  const handleDeleteAdminClient = () => {
    if (!supabase || !session?.user.id || role !== 'admin' || !selectedAdminClient) return
    openDeleteConfirmation({
      title: `Delete ${selectedAdminClient.full_name}?`,
      description: 'This removes the client, projects, deliveries, uploaded files, and database records.',
      confirmLabel: 'Delete client', progressLabel: 'Deleting client...',
      onConfirm: () => performDeleteAdminClient(selectedAdminClient.id, selectedAdminClient.full_name),
    })
  }

  const handleSaveAdminClient = () => {
    const fullName = adminClientDraft.fullName.trim()
    const email = adminClientDraft.email.trim().toLowerCase()
    const phone = adminClientDraft.phone.trim()
    const notes = adminClientDraft.notes.trim()
    if (!fullName || !email) { setAdminError('Client full name and email are required.'); return }
    setAdminBusy(true)
    setAdminError('')
    saveClientMutation.mutate(
      { fullName, email, phone, notes },
      { onSettled: () => setAdminBusy(false) }
    )
  }

  const handleCancelEdit = () => {
    if (!selectedAdminClient) return
    setAdminClientDraft({
      fullName: selectedAdminClient.full_name,
      email: selectedAdminClient.email,
      phone: selectedAdminClient.phone ?? '',
      notes: selectedAdminClient.notes ?? '',
    })
    setAdminClientEditMode(false)
  }

  const getAdminActivityContext = useCallback(
    (entry: AdminActivityItem) => {
      const client = entry.clientId ? adminClientById.get(entry.clientId) : null
      const project = entry.projectId ? adminProjectById.get(entry.projectId) : null
      const asset = entry.assetId ? adminAssetById.get(entry.assetId) : null
      const itemCount = typeof entry.metadata?.count === 'number' ? entry.metadata.count : null
      return { client, project, asset, itemCount }
    },
    [adminClientById, adminProjectById, adminAssetById]
  )

  return {
    // identity
    clientId,
    session,
    role,
    navigate,

    // client data
    selectedAdminClient,
    selectedAdminClientProjectViews,
    selectedAdminVisibleAssets,

    // edit form
    adminClientEditMode,
    setAdminClientEditMode,
    adminClientDraft,
    setAdminClientDraft,

    // filters
    adminAssetSearch,
    setAdminAssetSearch,
    adminProjectSort,
    setAdminProjectSort,
    adminAssetTypeFilter,
    setAdminAssetTypeFilter,
    adminProjectFilterId,
    setAdminProjectFilterId,

    // selection
    selectedAdminAssetIds,
    toggleSelectedAdminAsset,
    clearSelectedAdminAssets,
    selectVisibleAdminAssets,

    // preview
    adminAssetPreviewUrls,

    // lightbox
    adminLightbox,
    adminLightboxAsset,
    adminLightboxIndex,
    adminLightboxAssets,
    openAdminLightbox,
    closeAdminLightbox,
    moveAdminLightbox,

    // delete confirmation
    deleteConfirmation,
    closeDeleteConfirmation,
    confirmDeleteConfirmation,

    // activity
    activities,
    activityBusy,
    activityError,
    kindFilter,
    setKindFilter,
    activityExpanded,
    setActivityExpanded,
    getAdminActivityContext,

    // status
    adminBusy,
    adminError,
    adminActionMessage,

    // actions
    handleOpenAsset,
    handleDownloadAdminProject,
    handleDownloadSelectedAdminAssets,
    handleDeleteAdminAsset,
    handleDeleteAdminProject,
    handleBulkDeleteAdminAssets,
    handleDeleteAdminClient,
    handleSaveAdminClient,
    handleCancelEdit,
    loadMoreAdminProjectAssets,
  }
}
