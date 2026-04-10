import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { CustomerLightboxState, ShareLinkScope } from '../types'
import { useAuth } from './useAuth'
import { loadWorkerBlob, triggerBrowserDownload, workerRequest } from './useApi'
import { sanitizeDownloadName } from '../lib/upload'
import { useMyDeliveries } from './queries/useMyDeliveries'
import { useThumbnailBatch } from './queries/useThumbnailBatch'
import { usePreviewUrl } from './queries/usePreviewUrl'

export function useMyPictures() {
  const { session, getAccessToken } = useAuth()
  const email = session?.user.email

  // ── Query hooks ───────────────────────────────────────────────────────
  const deliveriesQuery = useMyDeliveries(email)
  const myDeliveries = useMemo(() => deliveriesQuery.data ?? [], [deliveriesQuery.data])

  const imageAssetIds = useMemo(
    () =>
      myDeliveries
        .flatMap((d) => d.assets)
        .filter((a) => a.mime_type.startsWith('image/'))
        .map((a) => a.id),
    [myDeliveries],
  )

  const thumbnailQuery = useThumbnailBatch(imageAssetIds, { getAccessToken })
  const customerThumbnailUrls = thumbnailQuery.data ?? {}

  // ── Unified selection state ──────────────────────────────────────────
  const [selectDeliveryId, setSelectDeliveryId] = useState('')
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])
  const [actionMessage, setActionMessage] = useState('')

  // ── Share link result state ──────────────────────────────────────────
  const [newShareLinks, setNewShareLinks] = useState<Record<string, string>>({})
  const [newShareLinkScopes, setNewShareLinkScopes] = useState<Record<string, ShareLinkScope>>({})
  const [shareCopyState, setShareCopyState] = useState<Record<string, string>>({})

  // ── Lightbox state ───────────────────────────────────────────────────
  const [customerLightbox, setCustomerLightbox] = useState<CustomerLightboxState | null>(null)

  const lightboxAssetId = customerLightbox?.assetId ?? ''
  const previewQuery = usePreviewUrl(lightboxAssetId, { getAccessToken })

  // ── Computed values ──────────────────────────────────────────────────
  const selectedAssetSet = useMemo(() => new Set(selectedAssetIds), [selectedAssetIds])
  const selectedCount = selectedAssetIds.length

  const customerVisibleAssets = useMemo(
    () => myDeliveries.flatMap((delivery) => delivery.assets),
    [myDeliveries],
  )

  const customerLightboxAssets = useMemo(() => {
    if (!customerLightbox) return []
    const delivery = myDeliveries.find((entry) => entry.deliveryId === customerLightbox.deliveryId)
    return (delivery?.assets ?? []).filter((asset) => asset.mime_type.startsWith('image/'))
  }, [customerLightbox, myDeliveries])

  const customerLightboxIndex = useMemo(() => {
    if (!customerLightbox) return -1
    return customerLightboxAssets.findIndex((asset) => asset.id === customerLightbox.assetId)
  }, [customerLightbox, customerLightboxAssets])

  const customerLightboxAsset = customerLightboxIndex >= 0 ? customerLightboxAssets[customerLightboxIndex] : null

  const customerPreviewUrls: Record<string, string> = useMemo(() => {
    if (!lightboxAssetId || !previewQuery.data) return {}
    return { [lightboxAssetId]: previewQuery.data }
  }, [lightboxAssetId, previewQuery.data])

  const customerBusy = deliveriesQuery.isLoading
  const customerError = deliveriesQuery.error
    ? deliveriesQuery.error instanceof Error
      ? deliveriesQuery.error.message
      : 'Failed to load deliveries'
    : ''

  // ── Selection handlers ──────────────────────────────────────────────

  const startSelectMode = (deliveryId: string) => {
    setSelectDeliveryId(deliveryId)
    setSelectedAssetIds([])
    setActionMessage('')
  }

  const exitSelectMode = () => {
    setSelectDeliveryId('')
    setSelectedAssetIds([])
    setActionMessage('')
  }

  const toggleAsset = (assetId: string) => {
    setSelectedAssetIds((current) =>
      current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId],
    )
  }

  const selectAllAssets = (deliveryId: string) => {
    const delivery = myDeliveries.find((d) => d.deliveryId === deliveryId)
    if (!delivery) return
    setSelectedAssetIds(delivery.assets.filter((a) => a.canDownload).map((a) => a.id))
  }

  const clearSelection = () => setSelectedAssetIds([])

  // ── Mutations ────────────────────────────────────────────────────────

  const downloadAllMutation = useMutation({
    mutationFn: async (deliveryId: string) => {
      const token = await getAccessToken()
      if (!token) throw new Error('Login session expired. Please log in again.')
      const delivery = myDeliveries.find((d) => d.deliveryId === deliveryId)
      const blob = await loadWorkerBlob(`/api/v1/deliveries/${deliveryId}/download`, token, {
        method: 'POST', body: {},
      })
      const name = sanitizeDownloadName(delivery?.projectName || delivery?.clientName || 'photos')
      triggerBrowserDownload(blob, `${name}.zip`)
    },
    onError: (error: Error) => { setActionMessage(error.message) },
  })

  const downloadSelectedMutation = useMutation({
    mutationFn: async ({ deliveryId, assetIds }: { deliveryId: string; assetIds: string[] }) => {
      const token = await getAccessToken()
      if (!token) throw new Error('Login session expired. Please log in again.')
      const delivery = myDeliveries.find((d) => d.deliveryId === deliveryId)
      const blob = await loadWorkerBlob(`/api/v1/deliveries/${deliveryId}/download`, token, {
        method: 'POST', body: { assetIds },
      })
      const name = sanitizeDownloadName(delivery?.projectName || delivery?.clientName || 'photos')
      triggerBrowserDownload(blob, `${name}-selected.zip`)
    },
    onSuccess: () => exitSelectMode(),
    onError: (error: Error) => { setActionMessage(error.message) },
  })

  const shareAllMutation = useMutation({
    mutationFn: async (deliveryId: string) => {
      const token = await getAccessToken()
      if (!token) throw new Error('Login session expired. Please log in again.')
      const payload = await workerRequest<{ url: string; scopeType: ShareLinkScope }>(
        '/api/v1/share-links', token,
        { method: 'POST', body: { deliveryId, expiresInDays: 7, scope: 'all', assetIds: [] } },
      )
      return { deliveryId, url: payload.url, scopeType: payload.scopeType ?? 'all' as ShareLinkScope }
    },
    onSuccess: ({ deliveryId, url, scopeType }) => {
      setNewShareLinks((current) => ({ ...current, [deliveryId]: url }))
      setNewShareLinkScopes((current) => ({ ...current, [deliveryId]: scopeType }))
      setShareCopyState((current) => ({ ...current, [deliveryId]: '' }))
    },
    onError: (error: Error) => { setActionMessage(error.message) },
  })

  const shareSelectedMutation = useMutation({
    mutationFn: async ({ deliveryId, assetIds }: { deliveryId: string; assetIds: string[] }) => {
      const token = await getAccessToken()
      if (!token) throw new Error('Login session expired. Please log in again.')
      const payload = await workerRequest<{ url: string; scopeType: ShareLinkScope }>(
        '/api/v1/share-links', token,
        { method: 'POST', body: { deliveryId, expiresInDays: 7, scope: 'selected', assetIds: [...new Set(assetIds)] } },
      )
      return { deliveryId, url: payload.url, scopeType: payload.scopeType ?? 'selected' as ShareLinkScope }
    },
    onSuccess: ({ deliveryId, url, scopeType }) => {
      setNewShareLinks((current) => ({ ...current, [deliveryId]: url }))
      setNewShareLinkScopes((current) => ({ ...current, [deliveryId]: scopeType }))
      setShareCopyState((current) => ({ ...current, [deliveryId]: '' }))
      exitSelectMode()
    },
    onError: (error: Error) => { setActionMessage(error.message) },
  })

  const actionBusy =
    downloadAllMutation.isPending ||
    downloadSelectedMutation.isPending ||
    shareAllMutation.isPending ||
    shareSelectedMutation.isPending

  // ── Action handlers ─────────────────────────────────────────────────

  const handleDownloadAll = (deliveryId: string) => downloadAllMutation.mutate(deliveryId)

  const handleDownloadSelected = () => {
    if (selectedAssetIds.length === 0 || !selectDeliveryId) return
    downloadSelectedMutation.mutate({ deliveryId: selectDeliveryId, assetIds: selectedAssetIds })
  }

  const handleShareAll = (deliveryId: string) => shareAllMutation.mutate(deliveryId)

  const handleShareSelected = () => {
    if (selectedAssetIds.length === 0 || !selectDeliveryId) return
    shareSelectedMutation.mutate({ deliveryId: selectDeliveryId, assetIds: selectedAssetIds })
  }

  const handleCopyShareLink = async (deliveryId: string) => {
    const link = newShareLinks[deliveryId]
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setShareCopyState((current) => ({ ...current, [deliveryId]: 'Copied' }))
    } catch {
      setShareCopyState((current) => ({ ...current, [deliveryId]: 'Copy failed' }))
    }
  }

  const handleOpenAsset = async (assetId: string, mode: 'view' | 'download') => {
    try {
      const token = await getAccessToken()
      if (!token) { setActionMessage('Login session expired. Please log in again.'); return }
      const endpoint = mode === 'view' ? '/api/v1/media/preview-url' : '/api/v1/media/signed-url'
      const payload = await workerRequest<{ signedUrl?: string; url?: string }>(endpoint, token, {
        method: 'POST', body: { assetId, mode },
      })
      const nextUrl = payload.url ?? payload.signedUrl
      if (!nextUrl) throw new Error('Missing asset URL')
      window.open(nextUrl, '_blank', 'noopener,noreferrer')
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Unable to open file')
    }
  }

  // ── Lightbox handlers ────────────────────────────────────────────────

  const openCustomerLightbox = (deliveryId: string, assetId: string) => {
    setCustomerLightbox({ deliveryId, assetId })
  }

  const closeCustomerLightbox = () => setCustomerLightbox(null)

  const moveCustomerLightbox = (direction: 'prev' | 'next') => {
    if (!customerLightbox || !customerLightboxAsset || customerLightboxIndex < 0) return
    const nextIndex = direction === 'next' ? customerLightboxIndex + 1 : customerLightboxIndex - 1
    if (nextIndex < 0 || nextIndex >= customerLightboxAssets.length) return
    setCustomerLightbox({
      deliveryId: customerLightbox.deliveryId,
      assetId: customerLightboxAssets[nextIndex].id,
    })
  }

  return {
    email,
    myDeliveries,
    customerVisibleAssets,
    customerThumbnailUrls,
    customerBusy,
    customerError,

    // selection
    selectDeliveryId,
    selectedAssetIds,
    selectedAssetSet,
    selectedCount,
    actionMessage,
    actionBusy,
    startSelectMode,
    exitSelectMode,
    toggleAsset,
    selectAllAssets,
    clearSelection,

    // share links
    newShareLinks,
    newShareLinkScopes,
    shareCopyState,

    // lightbox
    customerLightbox,
    customerLightboxAsset,
    customerLightboxIndex,
    customerLightboxAssets,
    customerPreviewUrls,
    openCustomerLightbox,
    closeCustomerLightbox,
    moveCustomerLightbox,

    // actions
    handleDownloadAll,
    handleDownloadSelected,
    handleShareAll,
    handleShareSelected,
    handleCopyShareLink,
    handleOpenAsset,
  }
}
