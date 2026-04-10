import { useMemo, useReducer, useRef } from 'react'
import type { ChangeEvent, DragEvent, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthContext } from '../context/AuthContext'
import { workerRequest } from '../hooks/useApi'
import { useAdminData } from '../context/AdminDataContext.tsx'
import { supabase } from '../lib/supabase'
import { buildUploadQueueGroups, collectDroppedUploadItems } from '../lib/upload'
import { randomToken } from '../lib/helpers'
import { uploadFormReducer, uploadFormInitialState } from '../reducers/uploadFormReducer'
import { queryClient } from '../lib/queryClient'
import { queryKeys } from '../lib/queryKeys'

export function UploadPage() {
  const navigate = useNavigate()
  const { session, role, getAccessToken } = useAuthContext()
  const { adminClients, recordAdminActivity, adminBusy, adminError } = useAdminData()

  const [state, dispatch] = useReducer(uploadFormReducer, uploadFormInitialState)
  const { clientMode: uploadClientMode, email: uploadEmail, reuseSearch: uploadReuseSearch, title: uploadTitle, items: uploadItems, dropActive: uploadDropActive, busy: uploadBusy, message: uploadMessage } = state

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
      [client.email, client.label].join(' ').toLowerCase().includes(query)
    )
  }, [reuseClientEmailOptions, uploadReuseSearch])

  const uploadQueueGroups = useMemo(() => buildUploadQueueGroups(uploadItems), [uploadItems])

  const handleUploadFilesChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []).map((file) => ({
      file,
      path: file.name,
    }))
    dispatch({ type: 'APPEND_ITEMS', items: selected })
    event.target.value = ''
  }

  const handleUploadBrowseClick = () => {
    uploadInputRef.current?.click()
  }

  const handleUploadDrop = async (event: DragEvent<HTMLDivElement>) => {
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

  const handleUploadDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    uploadDragDepthRef.current += 1
    dispatch({ type: 'SET_DROP_ACTIVE', active: true })
  }

  const handleUploadDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleUploadDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    uploadDragDepthRef.current = Math.max(0, uploadDragDepthRef.current - 1)
    if (uploadDragDepthRef.current === 0) {
      dispatch({ type: 'SET_DROP_ACTIVE', active: false })
    }
  }

  const uploadFileToSignedUrl = async (uploadUrl: string, file: File) => {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'content-type': file.type || 'application/octet-stream',
      },
      body: file,
    })
    if (!response.ok) {
      throw new Error(`Upload failed for ${file.name}`)
    }
  }

  const handleUploadDelivery = async (event: FormEvent) => {
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
      metadata: {
        mode: uploadClientMode,
      },
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
        const requestResult = await workerRequest<{
          objectKey: string
          uploadToken: string
          uploadUrl: string
        }>(
          '/api/v1/request-upload-url',
          token,
          {
            method: 'POST',
            body: {
              deliveryId: insertedDelivery.data.id,
              fileName: uploadDisplayName,
              contentType: item.file.type || 'application/octet-stream',
              fileSize: Math.max(1, item.file.size),
            },
          }
        )

        await uploadFileToSignedUrl(requestResult.uploadUrl, item.file)

        await workerRequest(
          '/api/v1/upload/complete',
          token,
          {
            method: 'POST',
            body: {
              deliveryId: insertedDelivery.data.id,
              objectKey: requestResult.objectKey,
              uploadToken: requestResult.uploadToken,
              fileName: uploadDisplayName,
              mimeType: item.file.type || 'application/octet-stream',
              bytes: Math.max(1, item.file.size),
            },
          }
        )
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
      }
    )
    dispatch({ type: 'RESET' })
    dispatch({ type: 'SET_MESSAGE', message: `Upload complete for ${targetEmail}. Opening the client folder now.` })
    navigate('/admin/clients/' + clientId)
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminClients(session.user.id) })
  }

  if (!session?.user.id) {
    return (
      <section className="portal-section admin-screen">
        <h2>Upload</h2>
        <p>Login required.</p>
      </section>
    )
  }

  if (role !== 'admin') {
    return (
      <section className="portal-section admin-screen">
        <h2>Upload</h2>
        <p className="portal-error">Only admin users can access uploads.</p>
      </section>
    )
  }

  return (
    <section className="portal-section admin-screen">
      <div className="portal-head admin-screen-head">
        <div>
          <p className="eyebrow">Admin upload</p>
          <h2>Deliver photos to a client</h2>
          <p>Choose a client, add files, and deliver — all in one go.</p>
        </div>
        <a className="button ghost" href="/admin/clients">
          View folders
        </a>
      </div>

      {adminBusy && <p className="portal-hint">Loading client folders...</p>}
      {adminError && <p className="portal-error">{adminError}</p>}

      <div className="admin-upload-summary" aria-label="Upload summary">
        <div className="admin-stat-card">
          <span>Client</span>
          <strong>
            {uploadClientMode === 'reuse'
              ? selectedUploadClient?.full_name ?? 'Choose an existing client'
              : 'Create new client'}
          </strong>
          <p className="portal-hint">
            {uploadClientMode === 'reuse'
              ? selectedUploadClient
                ? selectedUploadClient.email
                : 'Search or type an email to reuse an existing folder.'
              : 'A new client folder will be created from the email you enter.'}
          </p>
        </div>
        <div className="admin-stat-card">
          <span>Files</span>
          <strong>
            {uploadItems.length === 0
              ? 'No files added yet'
              : `${uploadItems.length} file${uploadItems.length === 1 ? '' : 's'}`}
          </strong>
          <p className="portal-hint">
            {uploadQueueGroups.length > 0
              ? `${uploadQueueGroups.filter((group) => group.isFolder).length} folder group${
                  uploadQueueGroups.filter((group) => group.isFolder).length === 1 ? '' : 's'
                }, ${uploadQueueGroups.filter((group) => !group.isFolder).length} file group${
                  uploadQueueGroups.filter((group) => !group.isFolder).length === 1 ? '' : 's'
                }`
              : 'Drop files or folders to build the upload queue.'}
          </p>
        </div>
        <div className="admin-stat-card">
          <span>Upload</span>
          <strong>{uploadTitle.trim() || 'Client Delivery'}</strong>
          <p className="portal-hint">
            {uploadBusy ? 'Preparing upload...' : 'The delivery title will be used as the client folder name.'}
          </p>
        </div>
      </div>

      <form className="admin-upload-layout" onSubmit={handleUploadDelivery}>
        <div className="admin-panel">
          <div className="admin-toggle" role="group" aria-label="Client folder mode">
            <button
              className={`admin-toggle-button ${uploadClientMode === 'create' ? 'is-active' : ''}`}
              type="button"
              onClick={() => dispatch({ type: 'SET_CLIENT_MODE', mode: 'create' })}
            >
              Create new
            </button>
            <button
              className={`admin-toggle-button ${uploadClientMode === 'reuse' ? 'is-active' : ''}`}
              type="button"
              onClick={() => dispatch({ type: 'SET_CLIENT_MODE', mode: 'reuse' })}
            >
              Reuse existing
            </button>
          </div>

          <label>
            Client email
            <input
              type="email"
              value={uploadEmail}
              onChange={(event) => dispatch({ type: 'SET_EMAIL', email: event.target.value })}
              placeholder="client@example.com"
              required
            />
          </label>
          {uploadClientMode === 'reuse' && (
            <div className="admin-reuse-picker">
              <label>
                Search existing clients
                <input
                  type="search"
                  value={uploadReuseSearch}
                  onChange={(event) => dispatch({ type: 'SET_REUSE_SEARCH', search: event.target.value })}
                  placeholder="Search by name or email"
                />
              </label>
              <label>
                Existing client email
                <select
                  value={selectedUploadClient?.email ?? ''}
                  onChange={(event) => dispatch({ type: 'SET_EMAIL', email: event.target.value })}
                  disabled={filteredReuseClientEmailOptions.length === 0}
                >
                  <option value="">Select an existing client</option>
                  {filteredReuseClientEmailOptions.map((client) => (
                    <option key={client.id} value={client.email}>
                      {client.email} {client.label ? `- ${client.label}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              {reuseClientEmailOptions.length === 0 ? (
                <p className="portal-hint">No existing clients loaded yet. Use manual email entry below.</p>
              ) : filteredReuseClientEmailOptions.length === 0 ? (
                <p className="portal-hint">
                  No existing clients match the search. Clear the search or type an email manually.
                </p>
              ) : (
                <p className="portal-hint">Choose an email to reuse that client folder, or type one manually below.</p>
              )}
            </div>
          )}

          <label>
            Delivery title
            <input
              type="text"
              value={uploadTitle}
              onChange={(event) => dispatch({ type: 'SET_TITLE', title: event.target.value })}
              required
            />
          </label>

          <p className="portal-hint">
            {uploadClientMode === 'create'
              ? 'Create a new client folder using the email you enter.'
              : selectedUploadClient
                ? `Files will be uploaded into ${selectedUploadClient.full_name}.`
                : 'Enter or select an existing client email to reuse that folder.'}
          </p>
        </div>

        <div className="admin-panel">
          <div
            className={`admin-dropzone ${uploadDropActive ? 'is-active' : ''}`}
            onDragEnter={handleUploadDragEnter}
            onDragOver={handleUploadDragOver}
            onDragLeave={handleUploadDragLeave}
            onDrop={handleUploadDrop}
            role="presentation"
          >
            <input
              ref={uploadInputRef}
              className="admin-dropzone-input"
              type="file"
              multiple
              onChange={handleUploadFilesChange}
            />
            <div className="admin-dropzone-copy">
              <p className="eyebrow">Upload content</p>
              <h3>{uploadDropActive ? 'Drop to upload' : 'Drop files or folders here'}</h3>
              <p>
                {uploadDropActive
                  ? 'Release to add files to the upload queue.'
                  : 'Drag a folder, drag individual files, or use the browse action to pick multiple items.'}
              </p>
            </div>
            <div className="admin-dropzone-actions">
              <button className="button ghost" type="button" onClick={handleUploadBrowseClick}>
                Browse files
              </button>
            </div>
          </div>

          {uploadQueueGroups.length > 0 && (
            <div className="admin-file-queue">
              {uploadQueueGroups.map((group) => (
                <div key={group.key} className="admin-file-pill">
                  <div className="admin-file-pill-copy">
                    <span>{group.label}</span>
                    <small>{group.isFolder ? `${group.count} items` : 'Single file'}</small>
                  </div>
                  <button
                    className="button ghost"
                    type="button"
                    onClick={() => dispatch({ type: 'REMOVE_GROUP', groupKey: group.key })}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <button className="button primary admin-upload-cta" type="submit" disabled={uploadBusy || uploadItems.length === 0}>
            {uploadBusy ? 'Delivering...' : 'Deliver to client'}
          </button>
        </div>
      </form>

      {uploadMessage && <p className="portal-hint">{uploadMessage}</p>}
    </section>
  )
}
