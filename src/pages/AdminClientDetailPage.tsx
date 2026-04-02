import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import type {
  AdminActivityKind,
  AdminActivityItem,
  AdminLightboxState,
  AdminProject,
  AdminProjectView,
  DeleteConfirmationState,
} from '../types'
import { useAuth } from '../hooks/useAuth'
import { workerRequest, loadWorkerBlob, triggerBrowserDownload } from '../hooks/useApi'
import { useAdminData } from '../context/AdminDataContext.tsx'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { supabase } from '../lib/supabase'
import { ADMIN_ACTIVITY_LIMIT, ADMIN_PROJECT_CHUNK_SIZE, getAssetKind } from '../lib/helpers'
import { getDisplayFileName, sanitizeDownloadName } from '../lib/upload'

export function AdminClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>()
  const { session, role, getAccessToken } = useAuth()
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
  const [adminActivities, setAdminActivities] = useState<AdminActivityItem[]>([])
  const [adminActivityBusy, setAdminActivityBusy] = useState(false)
  const [adminActivityError, setAdminActivityError] = useState('')
  const [adminActivityKindFilter, setAdminActivityKindFilter] = useState<'all' | AdminActivityKind>('all')
  const [adminActivityExpanded, setAdminActivityExpanded] = useState(false)
  const adminLightboxTouchStartRef = useRef<number | null>(null)

  const adminLightboxTrapRef = useFocusTrap(Boolean(adminLightbox))
  const deleteConfirmationTrapRef = useFocusTrap(Boolean(deleteConfirmation))

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

        return {
          project,
          totalAssets: filteredAssets.length,
          visibleAssets,
          latestActivityAt,
        }
      })

    projectViews.sort((left, right) => {
      if (adminProjectSort === 'name') {
        return left.project.name.localeCompare(right.project.name)
      }
      if (adminProjectSort === 'files') {
        return right.totalAssets - left.totalAssets
      }
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

  const adminActivityCounts = useMemo(() => {
    const counts: Record<'all' | AdminActivityKind, number> = {
      all: 0,
      upload: 0,
      download: 0,
      create: 0,
      edit: 0,
      delete: 0,
    }
    for (const activity of adminActivities) {
      counts.all += 1
      counts[activity.kind] += 1
    }
    return counts
  }, [adminActivities])

  const visibleAdminActivities = useMemo(() => {
    return adminActivities.filter((entry) => {
      const clientMatches = !selectedAdminClient?.id || entry.clientId === selectedAdminClient.id
      const kindMatches = adminActivityKindFilter === 'all' || entry.kind === adminActivityKindFilter
      return clientMatches && kindMatches
    })
  }, [adminActivities, adminActivityKindFilter, selectedAdminClient?.id])

  // --- effects ---

  // Sync adminClientDraft when selectedAdminClient changes
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

  // Reset selectedAdminAssetIds when visible assets change
  useEffect(() => {
    setSelectedAdminAssetIds((current) =>
      current.filter((assetId) => selectedAdminVisibleAssets.some((asset) => asset.id === assetId))
    )
  }, [selectedAdminVisibleAssets])

  // Reset adminProjectFilterId if selected project no longer exists
  useEffect(() => {
    if (adminProjectFilterId === 'all') return
    if (!selectedAdminClient?.projects.some((project) => project.id === adminProjectFilterId)) {
      setAdminProjectFilterId('all')
    }
  }, [adminProjectFilterId, selectedAdminClient?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset adminProjectRenderLimits when client changes
  useEffect(() => {
    setAdminProjectRenderLimits({})
  }, [selectedAdminClient?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update adminLightbox if current asset no longer visible
  useEffect(() => {
    if (!adminLightbox) return
    if (adminLightboxAssets.length === 0) {
      setAdminLightbox(null)
      return
    }
    if (adminLightboxIndex === -1) {
      setAdminLightbox({ projectId: adminLightbox.projectId, assetId: adminLightboxAssets[0].id })
    }
  }, [adminLightbox, adminLightboxAssets, adminLightboxIndex])

  // Load admin asset preview URLs (batch via preview-url-batch)
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
        '/api/v1/media/preview-url-batch',
        token,
        {
          method: 'POST',
          body: { assetIds: missingPreviewAssets.map((asset) => asset.id), variant: 'preview' },
        }
      )

      if (cancelled) return
      setAdminAssetPreviewUrls((current) => ({ ...current, ...(payload.urls ?? {}) }))
    }

    void loadPreviewUrls()
    return () => {
      cancelled = true
    }
  }, [adminAssetPreviewUrls, getAccessToken, role, selectedAdminVisibleAssets, session?.user.id])

  // Admin lightbox keyboard navigation
  useEffect(() => {
    if (!adminLightboxAsset) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeAdminLightbox()
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        moveAdminLightbox('prev')
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        moveAdminLightbox('next')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [adminLightboxAsset, adminLightboxAssets.length, adminLightboxIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  // Delete confirmation Escape key handler
  useEffect(() => {
    if (!deleteConfirmation) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setDeleteConfirmation(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [deleteConfirmation])

  // Load admin activity for selected client
  useEffect(() => {
    if (!supabase || !session?.user.id || role !== 'admin') return
    if (!selectedAdminClient?.id) return

    const loadAdminActivity = async (activityClientId: string) => {
      setAdminActivityBusy(true)
      setAdminActivityError('')

      try {
        const token = await getAccessToken()
        if (!token) {
          setAdminActivityError('Login session expired. Please log in again.')
          return
        }

        const params = new URLSearchParams({ limit: String(ADMIN_ACTIVITY_LIMIT) })
        params.set('clientId', activityClientId)

        const payload = await workerRequest<{ activities: AdminActivityItem[] }>(
          `/api/v1/admin/activity?${params.toString()}`,
          token
        )
        setAdminActivities(payload.activities ?? [])
      } catch (error) {
        setAdminActivityError(error instanceof Error ? error.message : 'Failed to load activity trail')
      } finally {
        setAdminActivityBusy(false)
      }
    }

    void loadAdminActivity(selectedAdminClient.id)
  }, [getAccessToken, role, selectedAdminClient?.id, session?.user.id])

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
        method: 'POST',
        body: { assetId: asset.id },
      })
      setAdminAssetPreviewUrls((current) => ({ ...current, [asset.id]: payload.url }))
    } catch {
      // The lightbox can still open; the image will retry from the existing preload effect.
    }
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
      if (!token) {
        setAdminError('Login session expired. Please log in again.')
        return
      }

      const endpoint = mode === 'view' ? '/api/v1/media/preview-url' : '/api/v1/media/signed-url'
      const payload = await workerRequest<{ signedUrl?: string; url?: string }>(endpoint, token, {
        method: 'POST',
        body: { assetId, mode },
      })
      const nextUrl = payload.url ?? payload.signedUrl
      if (!nextUrl) throw new Error('Missing asset URL')
      window.open(nextUrl, '_blank', 'noopener,noreferrer')

      if (mode === 'download') {
        const adminAsset = selectedAdminClient?.assets.find((entry) => entry.id === assetId)
        recordAdminActivity(
          'download',
          'Downloaded file',
          getDisplayFileName(adminAsset?.filename ?? assetId),
          {
            clientId: selectedAdminClient?.id ?? null,
            projectId: adminAsset?.project_id ?? null,
            assetId,
          }
        )
      }
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Unable to open file')
    }
  }

  const downloadAdminArchive = async (
    path: string,
    body: unknown,
    filename: string,
    activity?: {
      kind: AdminActivityKind
      title: string
      detail: string
      context?: {
        clientId?: string | null
        projectId?: string | null
        assetId?: string | null
        metadata?: Record<string, unknown>
      }
    }
  ) => {
    if (!supabase) return
    try {
      setAdminActionMessage(`Preparing ${filename}...`)
      setAdminBusy(true)
      const token = await getAccessToken()
      if (!token) {
        setAdminError('Login session expired. Please log in again.')
        return
      }

      const blob = await loadWorkerBlob(path, token, { method: 'POST', body })
      triggerBrowserDownload(blob, filename)
      if (activity) {
        recordAdminActivity(activity.kind, activity.title, activity.detail, activity.context)
      }
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Unable to download files')
    } finally {
      setAdminBusy(false)
      setAdminActionMessage('')
    }
  }

  const handleDownloadAdminProject = async (project: AdminProject) => {
    if (!supabase || !session?.user.id || role !== 'admin') return
    const projectAssetIds = selectedAdminClient?.assets
      .filter((asset) => asset.project_id === project.id)
      .map((asset) => asset.id) ?? []
    if (projectAssetIds.length === 0) {
      setAdminError('No files found for this folder.')
      return
    }
    await downloadAdminArchive(
      '/api/v1/admin/downloads',
      { assetIds: projectAssetIds, filename: project.name },
      `${sanitizeDownloadName(project.name)}.zip`,
      {
        kind: 'download',
        title: 'Downloaded folder',
        detail: project.name,
        context: {
          clientId: selectedAdminClient?.id ?? null,
          projectId: project.id,
          metadata: { count: projectAssetIds.length },
        },
      }
    )
  }

  const handleDownloadSelectedAdminAssets = async () => {
    if (!supabase || !session?.user.id || role !== 'admin' || selectedAdminAssetIds.length === 0) return
    const clientName = selectedAdminClient?.full_name ?? 'selected-files'
    await downloadAdminArchive(
      '/api/v1/admin/downloads',
      { assetIds: selectedAdminAssetIds, filename: clientName },
      `${sanitizeDownloadName(clientName)}-selected.zip`,
      {
        kind: 'download',
        title: 'Downloaded selection',
        detail: `${selectedAdminAssetIds.length} selected files from ${clientName}`,
        context: {
          clientId: selectedAdminClient?.id ?? null,
          metadata: { count: selectedAdminAssetIds.length, assetIds: selectedAdminAssetIds },
        },
      }
    )
  }

  const performDeleteAdminAsset = async (
    assetId: string,
    label?: string,
    context?: {
      clientId?: string | null
      projectId?: string | null
      assetId?: string | null
      metadata?: Record<string, unknown>
    },
    options?: { silent?: boolean }
  ) => {
    if (!supabase || !session?.user.id || role !== 'admin') return

    const token = await getAccessToken()
    if (!token) {
      setAdminError('Login session expired. Please log in again.')
      return
    }

    await workerRequest<{ ok: boolean }>(`/api/v1/admin/assets/${assetId}`, token, { method: 'DELETE' })
    setAdminClients((current) =>
      current.map((client) => {
        const nextAssets = client.assets.filter((asset) => asset.id !== assetId)
        return {
          ...client,
          assets: nextAssets,
          assetCount: nextAssets.length,
        }
      })
    )
    setSelectedAdminAssetIds((current) => current.filter((id) => id !== assetId))
    if (adminLightbox?.assetId === assetId) {
      closeAdminLightbox()
    }
    if (!options?.silent) {
      recordAdminActivity('delete', 'Deleted file', `Removed ${label ?? assetId}`, {
        clientId: context?.clientId ?? selectedAdminClient?.id ?? null,
        projectId: context?.projectId ?? null,
        assetId: context?.assetId ?? assetId,
        metadata: context?.metadata,
      })
    }
  }

  const performDeleteAdminAssets = async (assetIds: string[]) => {
    for (const assetId of assetIds) {
      await performDeleteAdminAsset(assetId, undefined, undefined, { silent: true })
    }
    recordAdminActivity(
      'delete',
      `Deleted ${assetIds.length} file${assetIds.length === 1 ? '' : 's'}`,
      'Removed selected files from the admin folder',
      {
        clientId: selectedAdminClient?.id ?? null,
        metadata: { count: assetIds.length, assetIds },
      }
    )
  }

  const performDeleteAdminProject = async (projectId: string, label?: string) => {
    if (!supabase || !session?.user.id || role !== 'admin') return

    const token = await getAccessToken()
    if (!token) {
      setAdminError('Login session expired. Please log in again.')
      return
    }

    await workerRequest<{ ok: boolean }>(`/api/v1/admin/projects/${projectId}`, token, {
      method: 'DELETE',
    })

    await loadAdminData()
    setSelectedAdminAssetIds([])
    if (adminLightbox?.projectId === projectId) {
      closeAdminLightbox()
    }
    recordAdminActivity('delete', 'Deleted folder', `Removed ${label ?? projectId}`, {
      clientId: selectedAdminClient?.id ?? null,
      projectId,
    })
  }

  const performDeleteAdminClient = async (deleteClientId: string, label?: string) => {
    if (!supabase || !session?.user.id || role !== 'admin') return

    const token = await getAccessToken()
    if (!token) {
      setAdminError('Login session expired. Please log in again.')
      return
    }

    await workerRequest<{ ok: boolean }>(`/api/v1/admin/clients/${deleteClientId}`, token, {
      method: 'DELETE',
    })

    setAdminClients((current) => current.filter((client) => client.id !== deleteClientId))
    setAdminClientEditMode(false)
    setAdminAssetSearch('')
    setSelectedAdminAssetIds([])
    closeAdminLightbox()
    window.location.hash = '#/admin/clients'
    recordAdminActivity('delete', 'Deleted client', `Removed ${label ?? deleteClientId}`, {
      clientId: deleteClientId,
    })
  }

  const handleDeleteAdminAsset = (assetId: string) => {
    if (!supabase || !session?.user.id || role !== 'admin' || !selectedAdminClient) return

    const asset =
      selectedAdminVisibleAssets.find((entry) => entry.id === assetId) ??
      selectedAdminClient.assets.find((entry) => entry.id === assetId)
    if (!asset) {
      setAdminError('File not found.')
      return
    }

    openDeleteConfirmation({
      title: `Delete ${getDisplayFileName(asset.filename)}?`,
      description:
        'This permanently removes the file from the folder, customer view, and database.',
      confirmLabel: 'Delete file',
      progressLabel: 'Deleting file...',
      onConfirm: () =>
        performDeleteAdminAsset(assetId, getDisplayFileName(asset.filename), {
          clientId: selectedAdminClient.id,
          projectId: asset.project_id,
          assetId: asset.id,
        }),
    })
  }

  const handleDeleteAdminProject = (project: AdminProject) => {
    if (!supabase || !session?.user.id || role !== 'admin') return

    openDeleteConfirmation({
      title: `Delete folder ${project.name}?`,
      description:
        'This removes the project, its uploaded files, the customer folder data, and the database records.',
      confirmLabel: 'Delete folder',
      progressLabel: 'Deleting folder...',
      onConfirm: () => performDeleteAdminProject(project.id, project.name),
    })
  }

  const handleBulkDeleteAdminAssets = () => {
    if (!supabase || !session?.user.id || role !== 'admin' || selectedAdminAssetIds.length === 0) return
    const assetIds = [...selectedAdminAssetIds]
    openDeleteConfirmation({
      title: `Delete ${assetIds.length} selected file${assetIds.length === 1 ? '' : 's'}?`,
      description:
        'This permanently removes the files from the folder, customer view, and database.',
      confirmLabel: 'Delete selected',
      progressLabel: `Deleting ${assetIds.length} selected file${assetIds.length === 1 ? '' : 's'}...`,
      onConfirm: async () => {
        await performDeleteAdminAssets(assetIds)
        setSelectedAdminAssetIds([])
      },
    })
  }

  const handleDeleteAdminClient = () => {
    if (!supabase || !session?.user.id || role !== 'admin' || !selectedAdminClient) return

    openDeleteConfirmation({
      title: `Delete ${selectedAdminClient.full_name}?`,
      description:
        'This removes the client, projects, deliveries, uploaded files, and database records.',
      confirmLabel: 'Delete client',
      progressLabel: 'Deleting client...',
      onConfirm: () => performDeleteAdminClient(selectedAdminClient.id, selectedAdminClient.full_name),
    })
  }

  const handleSaveAdminClient = async () => {
    if (!supabase || !session?.user.id || role !== 'admin' || !selectedAdminClient) return

    const fullName = adminClientDraft.fullName.trim()
    const email = adminClientDraft.email.trim().toLowerCase()
    const phone = adminClientDraft.phone.trim()
    const notes = adminClientDraft.notes.trim()

    if (!fullName || !email) {
      setAdminError('Client full name and email are required.')
      return
    }

    setAdminBusy(true)
    setAdminError('')

    try {
      const token = await getAccessToken()
      if (!token) {
        setAdminError('Login session expired. Please log in again.')
        return
      }

      const updated = await workerRequest<{ client: import('../types').AdminClient }>(
        `/api/v1/admin/clients/${selectedAdminClient.id}`,
        token,
        {
          method: 'PATCH',
          body: { fullName, email, phone, notes },
        }
      )

      setAdminClients((current) =>
        current.map((client) => (client.id === updated.client.id ? { ...client, ...updated.client } : client))
      )
      setAdminClientEditMode(false)
      recordAdminActivity('edit', 'Updated client', updated.client.full_name, {
        clientId: updated.client.id,
      })
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Unable to update client')
    } finally {
      setAdminBusy(false)
    }
  }

  const openDeleteConfirmation = (payload: DeleteConfirmationState) => {
    setDeleteConfirmation(payload)
  }

  const closeDeleteConfirmation = () => {
    setDeleteConfirmation(null)
  }

  const confirmDeleteConfirmation = async () => {
    const current = deleteConfirmation
    if (!current) return

    setDeleteConfirmation(null)
    setAdminActionMessage(current.progressLabel)
    setAdminBusy(true)
    setAdminError('')
    try {
      await current.onConfirm()
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Unable to complete delete')
    } finally {
      setAdminBusy(false)
      setAdminActionMessage('')
    }
  }

  const getAdminActivityContext = (entry: AdminActivityItem) => {
    const client = entry.clientId ? adminClientById.get(entry.clientId) : null
    const project = entry.projectId ? adminProjectById.get(entry.projectId) : null
    const asset = entry.assetId ? adminAssetById.get(entry.assetId) : null
    const itemCount = typeof entry.metadata?.count === 'number' ? entry.metadata.count : null
    return { client, project, asset, itemCount }
  }

  // --- auth guard ---
  if (!session?.user.id || role !== 'admin') {
    return (
      <section className="portal-section admin-screen">
        <h2>Client folder</h2>
        <p className="portal-error">Only admin users can access this page.</p>
      </section>
    )
  }

  if (!selectedAdminClient) {
    return (
      <section className="portal-section admin-screen">
        <div className="portal-head admin-screen-head">
          <div>
            <p className="eyebrow">Client folder</p>
            <h2>No client selected</h2>
            <p>Pick a client from the folder list to view their work.</p>
          </div>
          <button className="button ghost" type="button" onClick={() => { window.location.hash = '#/admin/clients' }}>
            Back to folders
          </button>
        </div>
      </section>
    )
  }

  // --- activity panel ---
  const renderAdminActivityPanel = () => (
    <section className="admin-activity-panel">
      <div className="admin-activity-panel-head">
        <div>
          <p className="eyebrow">Audit trail</p>
          <h3>Recent activity</h3>
        </div>
        <div className="admin-activity-panel-head-actions">
          <span className="admin-client-count">{visibleAdminActivities.length} events</span>
          <button
            className="button ghost"
            type="button"
            onClick={() => setAdminActivityExpanded((current) => !current)}
          >
            {adminActivityExpanded ? 'Hide activity' : 'Show activity'}
          </button>
        </div>
      </div>

      {adminActivityExpanded && (
        <>
          <div className="admin-activity-toolbar" role="toolbar" aria-label="Audit trail filters">
            <button
              className={`button ghost admin-activity-chip ${adminActivityKindFilter === 'all' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setAdminActivityKindFilter('all')}
            >
              All events
              <span>{adminActivityCounts.all}</span>
            </button>
            <button
              className={`button ghost admin-activity-chip ${adminActivityKindFilter === 'upload' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setAdminActivityKindFilter('upload')}
            >
              Uploads
              <span>{adminActivityCounts.upload}</span>
            </button>
            <button
              className={`button ghost admin-activity-chip ${adminActivityKindFilter === 'download' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setAdminActivityKindFilter('download')}
            >
              Downloads
              <span>{adminActivityCounts.download}</span>
            </button>
            <button
              className={`button ghost admin-activity-chip ${adminActivityKindFilter === 'create' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setAdminActivityKindFilter('create')}
            >
              Creates
              <span>{adminActivityCounts.create}</span>
            </button>
            <button
              className={`button ghost admin-activity-chip ${adminActivityKindFilter === 'edit' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setAdminActivityKindFilter('edit')}
            >
              Edits
              <span>{adminActivityCounts.edit}</span>
            </button>
            <button
              className={`button ghost admin-activity-chip ${adminActivityKindFilter === 'delete' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setAdminActivityKindFilter('delete')}
            >
              Deletes
              <span>{adminActivityCounts.delete}</span>
            </button>
          </div>

          <p className="portal-hint">Showing activity for the selected client folder.</p>
          {adminActivityBusy ? (
            <p className="portal-hint">Loading recent activity...</p>
          ) : adminActivityError ? (
            <p className="portal-error">{adminActivityError}</p>
          ) : visibleAdminActivities.length === 0 ? (
            <p className="portal-hint">No recent activity yet.</p>
          ) : (
            <ul className="admin-activity-list">
              {visibleAdminActivities.slice(0, 6).map((entry) => (
                <li key={entry.id} className={`admin-activity-item is-${entry.kind}`}>
                  {(() => {
                    const { client, project, asset, itemCount } = getAdminActivityContext(entry)
                    return (
                      <div>
                        <p className="admin-activity-title">{entry.title}</p>
                        <p className="admin-activity-detail">{entry.detail}</p>
                        <div className="admin-activity-context">
                          {client && <span>Client: {client.full_name}</span>}
                          {project && <span>Folder: {project.name}</span>}
                          {asset && <span>File: {getDisplayFileName(asset.filename)}</span>}
                          {itemCount !== null && (
                            <span>
                              {itemCount} item{itemCount === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })()}
                  <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )

  // --- main render ---
  return (
    <>
      <section className="portal-section admin-screen">
        <div className="portal-head admin-screen-head">
          <div>
            <p className="eyebrow">Client folder</p>
            <h2>{selectedAdminClient.full_name}</h2>
            <p>
              {selectedAdminClient.email}
              {selectedAdminClient.phone ? ` · ${selectedAdminClient.phone}` : ''}
            </p>
          </div>
          <div className="admin-head-actions">
            <button className="button ghost" type="button" onClick={() => { window.location.hash = '#/admin/clients' }}>
              Back
            </button>
            <button className="button ghost" type="button" onClick={() => { window.location.hash = '#/upload' }}>
              Upload more
            </button>
            <button
              className="button ghost"
              type="button"
              onClick={() => setAdminClientEditMode((current) => !current)}
            >
              {adminClientEditMode ? 'Close edit' : 'Edit client'}
            </button>
            <button className="button ghost" type="button" onClick={() => void handleDeleteAdminClient()}>
              Delete client
            </button>
          </div>
        </div>

        <div className="admin-detail-summary">
          <div className="admin-stat-card">
            <span>Projects</span>
            <strong>{selectedAdminClient.projectCount}</strong>
          </div>
          <div className="admin-stat-card">
            <span>Files</span>
            <strong>{selectedAdminClient.assetCount}</strong>
          </div>
          <div className="admin-stat-card">
            <span>Updated</span>
            <strong>{new Date(selectedAdminClient.latestUpdatedAt).toLocaleDateString()}</strong>
          </div>
        </div>

        {adminError && <p className="portal-error">{adminError}</p>}

        <div className="admin-detail-toolbar">
          <label className="admin-search">
            Search files
            <input
              type="search"
              value={adminAssetSearch}
              onChange={(event) => setAdminAssetSearch(event.target.value)}
              placeholder="Search by filename, type, or project"
            />
          </label>

          <label className="admin-search">
            Sort folders
            <select value={adminProjectSort} onChange={(event) => setAdminProjectSort(event.target.value as typeof adminProjectSort)}>
              <option value="recent">Recent activity</option>
              <option value="name">Name</option>
              <option value="files">File count</option>
            </select>
          </label>

          <label className="admin-search">
            Media type
            <select
              value={adminAssetTypeFilter}
              onChange={(event) => setAdminAssetTypeFilter(event.target.value as typeof adminAssetTypeFilter)}
            >
              <option value="all">All files</option>
              <option value="images">Images</option>
              <option value="videos">Videos</option>
              <option value="other">Other files</option>
            </select>
          </label>

          <label className="admin-search">
            Project
            <select value={adminProjectFilterId} onChange={(event) => setAdminProjectFilterId(event.target.value)}>
              <option value="all">All projects</option>
              {selectedAdminClient.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <div className="admin-detail-toolbar-copy">
            <p className="portal-hint">
              {selectedAdminAssetIds.length > 0
                ? `${selectedAdminAssetIds.length} selected file${selectedAdminAssetIds.length === 1 ? '' : 's'}`
                : `${selectedAdminVisibleAssets.length} loaded file${selectedAdminVisibleAssets.length === 1 ? '' : 's'}`}
              {adminAssetSearch.trim() ? ` matching "${adminAssetSearch.trim()}"` : ''}
            </p>
            {selectedAdminClient.notes && <p className="portal-hint">{selectedAdminClient.notes}</p>}
          </div>
        </div>

        {renderAdminActivityPanel()}

        <div className="admin-bulk-actions" aria-live="polite">
          <div className="admin-bulk-actions-copy">
            <p className="admin-bulk-actions-title">
              {selectedAdminAssetIds.length > 0
                ? `${selectedAdminAssetIds.length} selected file${selectedAdminAssetIds.length === 1 ? '' : 's'}`
                : `${selectedAdminVisibleAssets.length} visible file${selectedAdminVisibleAssets.length === 1 ? '' : 's'}`}
            </p>
            <p className="admin-bulk-actions-status">
              {adminActionMessage || 'Bulk actions stay pinned while you scroll through the folder.'}
            </p>
          </div>
          <div className="admin-bulk-actions-buttons">
            <button
              className="button ghost"
              type="button"
              onClick={selectVisibleAdminAssets}
              disabled={adminBusy || selectedAdminVisibleAssets.length === 0}
            >
              Select visible
            </button>
            <button
              className="button ghost"
              type="button"
              onClick={clearSelectedAdminAssets}
              disabled={adminBusy || selectedAdminAssetIds.length === 0}
            >
              Clear selection
            </button>
            <button
              className="button ghost"
              type="button"
              onClick={() => void handleDownloadSelectedAdminAssets()}
              disabled={adminBusy || selectedAdminAssetIds.length === 0}
            >
              Download selected
            </button>
            <button
              className="button ghost"
              type="button"
              onClick={() => void handleBulkDeleteAdminAssets()}
              disabled={adminBusy || selectedAdminAssetIds.length === 0}
            >
              Delete selected
            </button>
          </div>
        </div>

        {adminClientEditMode && (
          <div className="admin-client-form">
            <label>
              Full name
              <input
                type="text"
                value={adminClientDraft.fullName}
                onChange={(event) =>
                  setAdminClientDraft((current) => ({ ...current, fullName: event.target.value }))
                }
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={adminClientDraft.email}
                onChange={(event) =>
                  setAdminClientDraft((current) => ({ ...current, email: event.target.value }))
                }
              />
            </label>
            <label>
              Phone
              <input
                type="text"
                value={adminClientDraft.phone}
                onChange={(event) =>
                  setAdminClientDraft((current) => ({ ...current, phone: event.target.value }))
                }
              />
            </label>
            <label>
              Notes
              <textarea
                rows={4}
                value={adminClientDraft.notes}
                onChange={(event) =>
                  setAdminClientDraft((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </label>
            <div className="admin-form-actions">
              <button className="button primary" type="button" onClick={() => void handleSaveAdminClient()}>
                Save client
              </button>
              <button
                className="button ghost"
                type="button"
                onClick={() => {
                  if (!selectedAdminClient) return
                  setAdminClientDraft({
                    fullName: selectedAdminClient.full_name,
                    email: selectedAdminClient.email,
                    phone: selectedAdminClient.phone ?? '',
                    notes: selectedAdminClient.notes ?? '',
                  })
                  setAdminClientEditMode(false)
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="admin-project-stack">
          {selectedAdminClientProjectViews.length === 0 ? (
            <p className="portal-hint">
              {selectedAdminClient.projects.length === 0
                ? 'No projects yet for this client.'
                : 'No files match the current filters.'}
            </p>
          ) : (
            selectedAdminClientProjectViews.map(({ project, totalAssets, visibleAssets, latestActivityAt }) => (
              <article key={project.id} className="admin-project-card">
                <div className="delivery-header">
                  <div>
                    <p className="delivery-title">{project.name}</p>
                    <p className="delivery-expiry">
                      {project.status}
                      {project.shoot_date ? ` · ${project.shoot_date}` : ''}
                      {project.location ? ` · ${project.location}` : ''}
                    </p>
                  </div>
                  <div className="admin-project-actions">
                    <span className="admin-client-count">
                      {visibleAssets.length}/{totalAssets} files
                    </span>
                    <button className="button ghost" type="button" onClick={() => void handleDownloadAdminProject(project)}>
                      Download folder
                    </button>
                    <button className="button ghost" type="button" onClick={() => void handleDeleteAdminProject(project)}>
                      Delete folder
                    </button>
                  </div>
                </div>

                {visibleAssets.length === 0 ? (
                  <p className="portal-hint">No files in this project match the current search.</p>
                ) : (
                  <div className="admin-asset-grid">
                    {visibleAssets.map((asset) => {
                      const isSelected = selectedAdminAssetIds.includes(asset.id)
                      const previewUrl = adminAssetPreviewUrls[asset.id]
                      const isImage = asset.mime_type.startsWith('image/')
                      const displayName = getDisplayFileName(asset.filename)
                      return (
                        <article key={asset.id} className={`admin-asset-card ${isSelected ? 'is-selected' : ''}`}>
                          <button
                            className="admin-asset-select"
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => toggleSelectedAdminAsset(asset.id)}
                          >
                            <span className="admin-asset-checkbox">{isSelected ? '\u2713' : ''}</span>
                            <span className="sr-only">Select {displayName}</span>
                          </button>
                          {isImage ? (
                            <button
                              className="admin-asset-thumb admin-asset-thumb-button"
                              type="button"
                              onClick={() => void openAdminLightbox(project.id, asset.id)}
                              aria-label={`Open ${displayName}`}
                            >
                              {previewUrl ? (
                                <img src={previewUrl} alt={displayName} loading="lazy" />
                              ) : (
                                <div className="admin-asset-thumb-fallback">
                                  <span>IMG</span>
                                </div>
                              )}
                            </button>
                          ) : (
                            <div className="admin-asset-thumb">
                              <div className="admin-asset-thumb-fallback">
                                <span>{asset.mime_type.split('/')[0]?.slice(0, 1).toUpperCase() || 'F'}</span>
                              </div>
                            </div>
                          )}
                          <div className="admin-asset-main">
                            <p className="admin-asset-name">{displayName}</p>
                          </div>
                          <div className="delivery-asset-actions">
                            <button
                              className="button ghost"
                              type="button"
                              onClick={() => {
                                void handleOpenAsset(asset.id, 'download')
                              }}
                            >
                              Download
                            </button>
                            <button
                              className="button ghost"
                              type="button"
                              onClick={() => {
                                void handleDeleteAdminAsset(asset.id)
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                )}
                {totalAssets > visibleAssets.length && (
                  <div className="admin-project-more">
                    <p className="portal-hint">
                      Showing {visibleAssets.length} of {totalAssets} loaded files.
                    </p>
                    <button
                      className="button ghost"
                      type="button"
                      onClick={() => loadMoreAdminProjectAssets(project.id)}
                    >
                      Load more
                    </button>
                  </div>
                )}
                <p className="portal-hint admin-project-updated">Last activity {new Date(latestActivityAt).toLocaleString()}</p>
              </article>
            ))
          )}
        </div>

        {/* Admin lightbox */}
        {adminLightboxAsset && adminLightbox && (
          <div
            ref={adminLightboxTrapRef}
            className="admin-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={getDisplayFileName(adminLightboxAsset.filename)}
            onClick={closeAdminLightbox}
            onTouchStart={(event) => {
              adminLightboxTouchStartRef.current = event.touches[0]?.clientX ?? null
            }}
            onTouchEnd={(event) => {
              const start = adminLightboxTouchStartRef.current
              adminLightboxTouchStartRef.current = null
              if (start === null) return
              const delta = event.changedTouches[0]?.clientX - start
              if (Math.abs(delta) < 48) return
              if (delta < 0) {
                moveAdminLightbox('next')
              } else {
                moveAdminLightbox('prev')
              }
            }}
          >
            <div className="admin-lightbox-panel" onClick={(event) => event.stopPropagation()}>
              <button className="admin-lightbox-close" type="button" onClick={closeAdminLightbox}>
                Close
              </button>
              <div className="admin-lightbox-stage">
                {adminAssetPreviewUrls[adminLightboxAsset.id] ? (
                  <img
                    src={adminAssetPreviewUrls[adminLightboxAsset.id]}
                    alt={getDisplayFileName(adminLightboxAsset.filename)}
                  />
                ) : (
                  <div className="admin-lightbox-loading">Loading preview...</div>
                )}
              </div>
              <div className="admin-lightbox-meta">
                <p className="admin-lightbox-name">{getDisplayFileName(adminLightboxAsset.filename)}</p>
                <div className="admin-lightbox-actions">
                  <button
                    className="button ghost"
                    type="button"
                    onClick={() => moveAdminLightbox('prev')}
                    disabled={adminLightboxIndex <= 0}
                  >
                    Previous
                  </button>
                  <button
                    className="button ghost"
                    type="button"
                    onClick={() => moveAdminLightbox('next')}
                    disabled={adminLightboxIndex >= adminLightboxAssets.length - 1}
                  >
                    Next
                  </button>
                  <button
                    className="button ghost"
                    type="button"
                    onClick={() => void handleOpenAsset(adminLightboxAsset.id, 'download')}
                  >
                    Download
                  </button>
                </div>
                <p className="portal-hint">
                  {adminLightboxIndex + 1} / {adminLightboxAssets.length}
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Delete confirmation modal */}
      {deleteConfirmation && (
        <div
          ref={deleteConfirmationTrapRef}
          className="admin-confirm-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-confirm-title"
          aria-describedby="admin-confirm-description"
          onClick={closeDeleteConfirmation}
        >
          <div className="admin-confirm-panel" onClick={(event) => event.stopPropagation()}>
            <div className="admin-confirm-copy">
              <p className="eyebrow">Confirm delete</p>
              <h3 id="admin-confirm-title">{deleteConfirmation.title}</h3>
              <p id="admin-confirm-description">{deleteConfirmation.description}</p>
            </div>
            <div className="admin-confirm-actions">
              <button className="button ghost" type="button" onClick={closeDeleteConfirmation} disabled={adminBusy}>
                Cancel
              </button>
              <button
                className="button primary admin-confirm-destructive"
                type="button"
                onClick={() => void confirmDeleteConfirmation()}
                disabled={adminBusy}
              >
                {adminBusy ? 'Deleting...' : deleteConfirmation.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
