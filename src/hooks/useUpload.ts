import { useMemo, useReducer, useRef } from 'react'
import type { ChangeEvent, DragEvent, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthContext } from '../context/AuthContext'
import { workerRequest } from './useApi'
import { useAdminData } from '../context/AdminDataContext.tsx'
import { supabase } from '../lib/supabase'
import { buildUploadQueueGroups, collectDroppedUploadItems, uploadItemFolder } from '../lib/upload'
import { randomToken } from '../lib/helpers'
import { uploadFormReducer, uploadFormInitialState } from '../reducers/uploadFormReducer'
import { queryClient } from '../lib/queryClient'
import { queryKeys } from '../lib/queryKeys'

export function useUpload() {
  const navigate = useNavigate()
  const { session, role, getAccessToken } = useAuthContext()
  const { adminClients, recordAdminActivity, adminBusy, adminError } = useAdminData()

  const [state, dispatch] = useReducer(uploadFormReducer, uploadFormInitialState)
  const {
    clientMode: uploadClientMode,
    email: uploadEmail,
    reuseSearch: uploadReuseSearch,
    title: uploadTitle,
    items: uploadItems,
    dropActive: uploadDropActive,
    busy: uploadBusy,
    message: uploadMessage,
  } = state

  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const uploadDragDepthRef = useRef(0)

  const selectedUploadClient = useMemo(() => {
    const normalizedEmail = uploadEmail.trim().toLowerCase()
    if (!normalizedEmail) return null
    return adminClients.find((client) => client.email.trim().toLowerCase() === normalizedEmail) ?? null
  }, [adminClients, uploadEmail])

  const reuseClientEmailOptions = useMemo(() => {
    const seen = new Set<string>()
    return adminClients
      .map((client) => ({
        id: client.id,
        email: client.email.trim(),
        label: client.full_name.trim() || client.email.trim(),
      }))
      .filter((client) => {
        const key = client.email.toLowerCase()
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((left, right) => left.email.localeCompare(right.email))
  }, [adminClients])

  const filteredReuseClientEmailOptions = useMemo(() => {
    const query = uploadReuseSearch.trim().toLowerCase()
    if (!query) return reuseClientEmailOptions
    return reuseClientEmailOptions.filter((client) =>
      [client.email, client.label].join(' ').toLowerCase().includes(query),
    )
  }, [reuseClientEmailOptions, uploadReuseSearch])

  const uploadQueueGroups = useMemo(() => buildUploadQueueGroups(uploadItems), [uploadItems])

  /* ── Handlers ──────────────────────────────────────────────────── */

  const handleFilesChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []).map((file) => ({
      file,
      path: file.name,
    }))
    dispatch({ type: 'APPEND_ITEMS', items: selected })
    event.target.value = ''
  }

  const handleBrowseClick = () => {
    uploadInputRef.current?.click()
  }

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    uploadDragDepthRef.current = 0
    dispatch({ type: 'SET_DROP_ACTIVE', active: false })
    try {
      const dropped = await collectDroppedUploadItems(event.dataTransfer)
      dispatch({ type: 'APPEND_ITEMS', items: dropped })
    } catch (error) {
      dispatch({ type: 'SET_MESSAGE', message: error instanceof Error ? error.message : 'Unable to read dropped files' })
    }
  }

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    uploadDragDepthRef.current += 1
    dispatch({ type: 'SET_DROP_ACTIVE', active: true })
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    uploadDragDepthRef.current = Math.max(0, uploadDragDepthRef.current - 1)
    if (uploadDragDepthRef.current === 0) {
      dispatch({ type: 'SET_DROP_ACTIVE', active: false })
    }
  }

  const uploadFileToSignedUrl = async (uploadUrl: string, file: File) => {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': file.type || 'application/octet-stream' },
      body: file,
    })
    if (!response.ok) throw new Error(`Upload failed for ${file.name}`)
  }

  const handleDelivery = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !session?.user.id) return

    const targetEmail = uploadEmail.trim().toLowerCase()
    if (!targetEmail || uploadItems.length === 0) {
      dispatch({ type: 'SET_MESSAGE', message: 'Enter a client email and add at least one file or folder item.' })
      return
    }

    dispatch({ type: 'SET_BUSY', busy: true })
    dispatch({ type: 'SET_MESSAGE', message: '' })

    const existingClient = await supabase
      .from('clients')
      .select('id')
      .eq('email', targetEmail)
      .eq('owner_user_id', session.user.id)
      .maybeSingle()

    if (existingClient.error) {
      dispatch({ type: 'SET_MESSAGE', message: existingClient.error.message })
      dispatch({ type: 'SET_BUSY', busy: false })
      return
    }

    let clientId = existingClient.data?.id ?? ''

    if (uploadClientMode === 'create') {
      if (clientId) {
        dispatch({ type: 'SET_MESSAGE', message: 'That client already exists. Switch to Reuse existing.' })
        dispatch({ type: 'SET_BUSY', busy: false })
        return
      }

      const insertedClient = await supabase
        .from('clients')
        .insert({
          owner_user_id: session.user.id,
          full_name: targetEmail.split('@')[0] || 'Client',
          email: targetEmail,
        })
        .select('id')
        .single()

      if (insertedClient.error || !insertedClient.data) {
        dispatch({ type: 'SET_MESSAGE', message: insertedClient.error?.message ?? 'Unable to create client.' })
        dispatch({ type: 'SET_BUSY', busy: false })
        return
      }

      clientId = insertedClient.data.id
    } else if (!clientId) {
      dispatch({ type: 'SET_MESSAGE', message: 'No existing client found for that email. Switch to Create new.' })
      dispatch({ type: 'SET_BUSY', busy: false })
      return
    }

    const insertedProject = await supabase
      .from('projects')
      .insert({
        owner_user_id: session.user.id,
        client_id: clientId,
        name: uploadTitle || `Delivery ${new Date().toISOString().slice(0, 10)}`,
        status: 'active',
      })
      .select('id')
      .single()

    if (insertedProject.error || !insertedProject.data) {
      dispatch({ type: 'SET_MESSAGE', message: insertedProject.error?.message ?? 'Unable to create project.' })
      dispatch({ type: 'SET_BUSY', busy: false })
      return
    }

    recordAdminActivity('create', 'Created folder', uploadTitle, {
      clientId,
      projectId: insertedProject.data.id,
      metadata: { mode: uploadClientMode },
    })

    const deliveryToken = randomToken()
    const insertedDelivery = await supabase
      .from('deliveries')
      .insert({
        owner_user_id: session.user.id,
        project_id: insertedProject.data.id,
        client_id: clientId,
        status: 'shared',
        access_token: deliveryToken,
        shared_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (insertedDelivery.error || !insertedDelivery.data) {
      dispatch({ type: 'SET_MESSAGE', message: insertedDelivery.error?.message ?? 'Unable to create delivery.' })
      dispatch({ type: 'SET_BUSY', busy: false })
      return
    }

    const recipientInsert = await supabase.from('delivery_recipients').insert({
      delivery_id: insertedDelivery.data.id,
      email: targetEmail,
      access_mode: 'owner',
    })

    if (recipientInsert.error) {
      dispatch({ type: 'SET_MESSAGE', message: recipientInsert.error.message })
      dispatch({ type: 'SET_BUSY', busy: false })
      return
    }

    const token = await getAccessToken()
    if (!token) {
      dispatch({ type: 'SET_MESSAGE', message: 'Login session expired. Please log in again.' })
      dispatch({ type: 'SET_BUSY', busy: false })
      return
    }

    try {
      for (const item of uploadItems) {
        const uploadDisplayName = item.path.trim() || item.file.name
        const folder = uploadItemFolder(item.path)
        const requestResult = await workerRequest<{
          objectKey: string
          uploadToken: string
          uploadUrl: string
        }>('/api/v1/request-upload-url', token, {
          method: 'POST',
          body: {
            deliveryId: insertedDelivery.data.id,
            fileName: uploadDisplayName,
            contentType: item.file.type || 'application/octet-stream',
            fileSize: Math.max(1, item.file.size),
          },
        })

        await uploadFileToSignedUrl(requestResult.uploadUrl, item.file)

        await workerRequest('/api/v1/upload/complete', token, {
          method: 'POST',
          body: {
            deliveryId: insertedDelivery.data.id,
            objectKey: requestResult.objectKey,
            uploadToken: requestResult.uploadToken,
            fileName: uploadDisplayName,
            mimeType: item.file.type || 'application/octet-stream',
            bytes: Math.max(1, item.file.size),
            folder,
          },
        })
      }
    } catch (error) {
      dispatch({ type: 'SET_MESSAGE', message: error instanceof Error ? error.message : 'Upload failed' })
      dispatch({ type: 'SET_BUSY', busy: false })
      return
    }

    recordAdminActivity(
      'upload',
      'Uploaded files',
      `${uploadItems.length} file${uploadItems.length === 1 ? '' : 's'} to ${targetEmail}`,
      {
        clientId,
        projectId: insertedProject.data.id,
        metadata: {
          count: uploadItems.length,
          deliveryId: insertedDelivery.data.id,
          mode: uploadClientMode,
        },
      },
    )
    /* Stash the delivery so the page can render the success card + the
       "Send notification email" button. We don't auto-navigate anymore —
       the admin reviews the result first, sends the email, then clicks
       through to the client folder when they're ready. */
    dispatch({
      type: 'SET_LAST_DELIVERY',
      delivery: {
        deliveryId: insertedDelivery.data.id,
        clientId,
        clientEmail: targetEmail,
        title: uploadTitle || `Delivery ${new Date().toISOString().slice(0, 10)}`,
        fileCount: uploadItems.length,
        notifiedAt: null,
        notifying: false,
        notifyError: null,
      },
    })
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminClients(session.user.id) })
  }

  /**
   * Send the "your photos are ready" email for the just-uploaded delivery.
   * Surfaces 503 (email not configured) and other errors inline so the
   * admin can fix-and-retry without losing the success card.
   */
  const notifyClient = async () => {
    const target = state.lastDelivery
    if (!target || target.notifying) return
    const token = await getAccessToken()
    if (!token) {
      dispatch({ type: 'NOTIFY_ERROR', error: 'Session expired. Sign in again.' })
      return
    }
    dispatch({ type: 'NOTIFY_START' })
    try {
      const result = await workerRequest<{ sentAt: string; messageId: string }>(
        `/api/v1/admin/deliveries/${target.deliveryId}/notify`,
        token,
        { method: 'POST', body: {} }
      )
      dispatch({ type: 'NOTIFY_SUCCESS', sentAt: result.sentAt })
    } catch (error) {
      dispatch({ type: 'NOTIFY_ERROR', error: error instanceof Error ? error.message : 'Unable to send email' })
    }
  }

  const dismissLastDelivery = () => dispatch({ type: 'CLEAR_LAST_DELIVERY' })

  const openClientFolder = (clientId: string) => {
    dismissLastDelivery()
    navigate('/admin/clients/' + clientId)
  }

  return {
    session,
    role,
    adminBusy,
    adminError,
    uploadClientMode,
    uploadEmail,
    uploadReuseSearch,
    uploadTitle,
    uploadItems,
    uploadDropActive,
    uploadBusy,
    uploadMessage,
    uploadInputRef,
    selectedUploadClient,
    filteredReuseClientEmailOptions,
    reuseClientEmailOptions,
    uploadQueueGroups,
    lastDelivery: state.lastDelivery,
    dispatch,
    handleFilesChange,
    handleBrowseClick,
    handleDrop,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDelivery,
    notifyClient,
    dismissLastDelivery,
    openClientFolder,
  }
}
