import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import './App.css'

type Role = 'admin' | 'customer'

type Profile = {
  id: string
  email: string
  role: Role
  displayName: string | null
}

type Client = {
  id: string
  full_name: string
  email: string
  phone: string | null
  notes: string | null
}

type Project = {
  id: string
  client_id: string
  name: string
  description: string | null
  shoot_date: string | null
  location: string | null
  status: 'draft' | 'active' | 'completed' | 'archived'
}

type UploadRecord = {
  fileName: string
  status: 'pending' | 'uploading' | 'finalizing' | 'done' | 'failed'
  attempts: number
  progress: number
  message: string
}

type DeliveryAsset = {
  id: string
  filename: string
  mime_type: string
  bytes: number
  canView: boolean
  canDownload: boolean
}

type DeliveryGallery = {
  deliveryId: string
  accessMode: 'owner' | 'viewer' | 'admin'
  expiresAt: string | null
  assets: DeliveryAsset[]
}

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '')
const requestTimeoutMs = 20_000

const apiRequest = async <T,>(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  token: string,
  body?: unknown
): Promise<T> => {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs)
  let response: Response | null = null
  let text = ''
  let parsed: Record<string, unknown> = {}

  try {
    response = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    text = await response.text()
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request timed out. Please retry.')
    }
    throw new Error('Network request failed. Check connection and retry.')
  } finally {
    window.clearTimeout(timeout)
  }

  if (!response || !response.ok) {
    const message =
      typeof parsed?.error === 'object' &&
      parsed.error !== null &&
      typeof (parsed.error as { message?: string }).message === 'string'
        ? ((parsed.error as { message: string }).message ?? 'Request failed')
        : 'Request failed'
    throw new Error(message)
  }

  return parsed as T
}

const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

const putFileToSignedUrl = (
  uploadUrl: string,
  file: File,
  onProgress: (value: number) => void
): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', uploadUrl)
    request.timeout = 2 * 60 * 1000
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      onProgress(Math.round((event.loaded / event.total) * 100))
    }
    request.onerror = () => reject(new Error('Network upload error'))
    request.ontimeout = () => reject(new Error('Upload timed out'))
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100)
        resolve()
        return
      }
      reject(new Error(`Upload failed with status ${request.status}`))
    }
    request.send(file)
  })

const ClientEditor = ({
  client,
  token,
  onSaved,
  onDeleted,
}: {
  client: Client
  token: string
  onSaved: (client: Client) => void
  onDeleted: (id: string) => void
}) => {
  const [fullName, setFullName] = useState(client.full_name)
  const [email, setEmail] = useState(client.email)
  const [phone, setPhone] = useState(client.phone ?? '')
  const [notes, setNotes] = useState(client.notes ?? '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      const data = await apiRequest<{ client: Client }>(
        `/api/v1/admin/clients/${client.id}`,
        'PATCH',
        token,
        { fullName, email, phone, notes }
      )
      onSaved(data.client)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm('Delete this client?')) return
    setBusy(true)
    try {
      await apiRequest<{ ok: boolean }>(`/api/v1/admin/clients/${client.id}`, 'DELETE', token)
      onDeleted(client.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card compact">
      <div className="grid">
        <input value={fullName} onChange={(event) => setFullName(event.target.value)} />
        <input value={email} onChange={(event) => setEmail(event.target.value)} />
        <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Phone" />
        <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes" />
      </div>
      <div className="actions">
        <button disabled={busy} onClick={save}>
          Save
        </button>
        <button disabled={busy} className="danger" onClick={remove}>
          Delete
        </button>
      </div>
    </div>
  )
}

const ProjectEditor = ({
  project,
  token,
  onSaved,
  onDeleted,
}: {
  project: Project
  token: string
  onSaved: (project: Project) => void
  onDeleted: (id: string) => void
}) => {
  const [name, setName] = useState(project.name)
  const [status, setStatus] = useState<Project['status']>(project.status)
  const [description, setDescription] = useState(project.description ?? '')
  const [shootDate, setShootDate] = useState(project.shoot_date ?? '')
  const [location, setLocation] = useState(project.location ?? '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      const data = await apiRequest<{ project: Project }>(
        `/api/v1/admin/projects/${project.id}`,
        'PATCH',
        token,
        { name, status, description, shootDate, location }
      )
      onSaved(data.project)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm('Delete this project?')) return
    setBusy(true)
    try {
      await apiRequest<{ ok: boolean }>(`/api/v1/admin/projects/${project.id}`, 'DELETE', token)
      onDeleted(project.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card compact">
      <div className="grid">
        <input value={name} onChange={(event) => setName(event.target.value)} />
        <select value={status} onChange={(event) => setStatus(event.target.value as Project['status'])}>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
        </select>
        <input
          value={shootDate}
          onChange={(event) => setShootDate(event.target.value)}
          placeholder="Shoot date YYYY-MM-DD"
        />
        <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Location" />
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Description"
        />
      </div>
      <div className="actions">
        <button disabled={busy} onClick={save}>
          Save
        </button>
        <button disabled={busy} className="danger" onClick={remove}>
          Delete
        </button>
      </div>
    </div>
  )
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const [clients, setClients] = useState<Client[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [newClientName, setNewClientName] = useState('')
  const [newClientEmail, setNewClientEmail] = useState('')
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectClientId, setNewProjectClientId] = useState('')
  const [uploadDeliveryId, setUploadDeliveryId] = useState('')
  const [uploadQueue, setUploadQueue] = useState<File[]>([])
  const [uploadRecords, setUploadRecords] = useState<UploadRecord[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [deliveries, setDeliveries] = useState<DeliveryGallery[]>([])
  const [galleryLoading, setGalleryLoading] = useState(false)

  const token = session?.access_token ?? ''

  const sortedClients = useMemo(() => [...clients].sort((a, b) => a.full_name.localeCompare(b.full_name)), [clients])

  const loadAdminData = async (accessToken: string) => {
    const [clientsResponse, projectsResponse] = await Promise.all([
      apiRequest<{ clients: Client[] }>('/api/v1/admin/clients', 'GET', accessToken),
      apiRequest<{ projects: Project[] }>('/api/v1/admin/projects', 'GET', accessToken),
    ])
    setClients(clientsResponse.clients)
    setProjects(projectsResponse.projects)
  }

  const loadPrivateGallery = async (accessToken: string) => {
    setGalleryLoading(true)
    try {
      const response = await apiRequest<{ deliveries: DeliveryGallery[] }>(
        '/api/v1/my-pictures',
        'GET',
        accessToken
      )
      setDeliveries(response.deliveries)
    } finally {
      setGalleryLoading(false)
    }
  }

  const loadProfile = async (activeSession: Session | null) => {
    if (!activeSession) {
      setProfile(null)
      setClients([])
      setProjects([])
      setDeliveries([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')
    try {
      const me = await apiRequest<Profile>('/api/v1/me', 'GET', activeSession.access_token)
      setProfile(me)
      if (me.role === 'admin') {
        await loadAdminData(activeSession.access_token)
      }
      await loadPrivateGallery(activeSession.access_token)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load profile')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      void loadProfile(data.session)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      void loadProfile(nextSession)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const onLogin = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setAuthMessage('')

    try {
      if (password.trim()) {
        const { error: loginError } = await supabase.auth.signInWithPassword({ email, password })
        if (loginError) throw loginError
        setAuthMessage('Signed in successfully.')
      } else {
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.origin },
        })
        if (otpError) throw otpError
        setAuthMessage('Magic link sent. Complete login from your email inbox.')
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Sign-in failed')
    }
  }

  const onLogout = async () => {
    await supabase.auth.signOut()
    setAuthMessage('Signed out.')
  }

  const createClient = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    const data = await apiRequest<{ client: Client }>('/api/v1/admin/clients', 'POST', token, {
      fullName: newClientName,
      email: newClientEmail,
    })
    setClients((current) => [data.client, ...current])
    setNewClientName('')
    setNewClientEmail('')
    if (!newProjectClientId) setNewProjectClientId(data.client.id)
  }

  const createProject = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    const data = await apiRequest<{ project: Project }>('/api/v1/admin/projects', 'POST', token, {
      clientId: newProjectClientId,
      name: newProjectName,
    })
    setProjects((current) => [data.project, ...current])
    setNewProjectName('')
  }

  const updateUploadRecord = (fileName: string, patch: Partial<UploadRecord>) => {
    setUploadRecords((current) =>
      current.map((record) => (record.fileName === fileName ? { ...record, ...patch } : record))
    )
  }

  const requestAssetUrl = async (assetId: string, mode: 'view' | 'download') => {
    if (!token) return
    setError('')
    try {
      const result = await apiRequest<{ signedUrl: string }>('/api/v1/media/signed-url', 'POST', token, {
        assetId,
        mode,
      })
      window.open(result.signedUrl, '_blank', 'noopener,noreferrer')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to open media')
    }
  }

  const uploadSelectedFiles = async (event: FormEvent) => {
    event.preventDefault()
    if (!uploadDeliveryId.trim() || uploadQueue.length === 0 || !token) return

    setError('')
    setAuthMessage('')
    setIsUploading(true)
    setUploadRecords(
      uploadQueue.map((file) => ({
        fileName: file.name,
        status: 'pending',
        attempts: 0,
        progress: 0,
        message: 'Queued',
      }))
    )

    try {
      const failedUploads: string[] = []
      for (const file of uploadQueue) {
        let completed = false
        for (let attempt = 1; attempt <= 3 && !completed; attempt += 1) {
          updateUploadRecord(file.name, {
            status: 'uploading',
            attempts: attempt,
            message: `Requesting signed URL (attempt ${attempt}/3)...`,
            progress: 0,
          })

          try {
            const requestResult = await apiRequest<{
              objectKey: string
              uploadToken: string
              uploadUrl: string
              expiresInSeconds: number
            }>('/api/v1/request-upload-url', 'POST', token, {
              deliveryId: uploadDeliveryId.trim(),
              fileName: file.name,
              contentType: file.type || 'application/octet-stream',
              fileSize: file.size,
            })

            updateUploadRecord(file.name, {
              status: 'uploading',
              message: `Uploading directly to R2 (attempt ${attempt}/3)...`,
            })

            await putFileToSignedUrl(requestResult.uploadUrl, file, (progress) => {
              updateUploadRecord(file.name, { progress })
            })

            updateUploadRecord(file.name, {
              status: 'finalizing',
              message: 'Saving asset metadata...',
            })

            await apiRequest<{ ok: boolean; assetId: string | null }>('/api/v1/upload/complete', 'POST', token, {
              deliveryId: uploadDeliveryId.trim(),
              objectKey: requestResult.objectKey,
              uploadToken: requestResult.uploadToken,
              fileName: file.name,
              mimeType: file.type || 'application/octet-stream',
              bytes: file.size,
            })

            updateUploadRecord(file.name, {
              status: 'done',
              progress: 100,
              message: 'Upload completed',
            })
            completed = true
          } catch (uploadError) {
            const reason = uploadError instanceof Error ? uploadError.message : 'Upload failed'
            const hasRetry = attempt < 3
            updateUploadRecord(file.name, {
              status: hasRetry ? 'uploading' : 'failed',
              message: hasRetry ? `${reason} — retrying...` : reason,
            })
            if (hasRetry) {
              await pause(attempt * 800)
              continue
            }
            failedUploads.push(file.name)
          }
        }
      }
      if (failedUploads.length > 0) {
        setError(`Some uploads failed: ${failedUploads.join(', ')}`)
      } else {
        setAuthMessage('All selected uploads completed successfully.')
      }
    } finally {
      setIsUploading(false)
    }
  }

  if (!apiBase) {
    return (
      <main className="page">
        <section className="card">
          <h1>Day 4 Delivery + Downloads</h1>
          <p>Set VITE_API_BASE_URL in your .env file before running this app.</p>
        </section>
      </main>
    )
  }

  return (
    <main className="page">
      <section className="card">
        <h1>Week 1 Day 4: Client Delivery + Secure Downloads</h1>
        <p className="muted">Stack: React + Supabase auth + Cloudflare Worker private gallery delivery APIs.</p>

        {!session ? (
          <form onSubmit={onLogin} className="stack">
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@example.com"
                required
              />
            </label>
            <label>
              Password (optional)
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Use blank for magic-link login"
              />
            </label>
            <button type="submit">Sign In</button>
          </form>
        ) : (
          <div className="stack">
            <div className="row between">
              <div>
                <p className="muted">Logged in as</p>
                <strong>{profile?.email ?? session.user.email}</strong>
              </div>
              <button onClick={onLogout}>Sign Out</button>
            </div>
          </div>
        )}

        {authMessage && <p className="success">{authMessage}</p>}
        {error && <p className="error">{error}</p>}
      </section>

      {loading ? <section className="card">Loading account context...</section> : null}

      {session && profile && profile.role !== 'admin' ? (
        <section className="card">
          <h2>Private Gallery Access</h2>
          <p>
            Your role is <strong>{profile.role}</strong>. Admin CRUD endpoints are blocked for this account.
          </p>
        </section>
      ) : null}

      {session && profile ? (
        <section className="card">
          <div className="row between">
            <h2>Private Client Deliveries</h2>
            <button disabled={galleryLoading} onClick={() => void loadPrivateGallery(token)}>
              {galleryLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {deliveries.length === 0 ? (
            <p className="muted">No active delivery files for this account.</p>
          ) : (
            <div className="stack">
              {deliveries.map((delivery) => (
                <div className="card compact" key={delivery.deliveryId}>
                  <p>
                    <strong>Delivery:</strong> {delivery.deliveryId}
                  </p>
                  <p className="muted">
                    Access: {delivery.accessMode}
                    {delivery.expiresAt ? ` | Expires: ${new Date(delivery.expiresAt).toLocaleString()}` : ''}
                  </p>
                  <div className="stack">
                    {delivery.assets.map((asset) => (
                      <div className="row between" key={asset.id}>
                        <span>
                          {asset.filename} ({Math.max(1, Math.round(asset.bytes / 1024))} KB)
                        </span>
                        <div className="actions">
                          <button onClick={() => void requestAssetUrl(asset.id, 'view')}>View</button>
                          <button
                            disabled={!asset.canDownload}
                            onClick={() => void requestAssetUrl(asset.id, 'download')}
                          >
                            Download
                          </button>
                        </div>
                      </div>
                    ))}
                    {delivery.assets.length === 0 ? <p className="muted">No files visible in this delivery.</p> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {session && profile?.role === 'admin' ? (
        <>
          <section className="card">
            <h2>Admin Clients CRUD</h2>
            <form onSubmit={createClient} className="row">
              <input
                value={newClientName}
                onChange={(event) => setNewClientName(event.target.value)}
                placeholder="Client full name"
                required
              />
              <input
                type="email"
                value={newClientEmail}
                onChange={(event) => setNewClientEmail(event.target.value)}
                placeholder="client@example.com"
                required
              />
              <button type="submit">Create Client</button>
            </form>
            <div className="stack">
              {sortedClients.map((client) => (
                <ClientEditor
                  key={client.id}
                  client={client}
                  token={token}
                  onSaved={(saved) => setClients((current) => current.map((item) => (item.id === saved.id ? saved : item)))}
                  onDeleted={(id) => setClients((current) => current.filter((item) => item.id !== id))}
                />
              ))}
              {sortedClients.length === 0 ? <p className="muted">No clients yet.</p> : null}
            </div>
          </section>

          <section className="card">
            <h2>Admin Projects CRUD</h2>
            <form onSubmit={createProject} className="row">
              <select
                value={newProjectClientId}
                onChange={(event) => setNewProjectClientId(event.target.value)}
                required
              >
                <option value="">Select client</option>
                {sortedClients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.full_name}
                  </option>
                ))}
              </select>
              <input
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                placeholder="Project name"
                required
              />
              <button type="submit">Create Project</button>
            </form>

            <div className="stack">
              {projects.map((project) => (
                <ProjectEditor
                  key={project.id}
                  project={project}
                  token={token}
                  onSaved={(saved) =>
                    setProjects((current) => current.map((item) => (item.id === saved.id ? saved : item)))
                  }
                  onDeleted={(id) => setProjects((current) => current.filter((item) => item.id !== id))}
                />
              ))}
              {projects.length === 0 ? <p className="muted">No projects yet.</p> : null}
            </div>
          </section>

          <section className="card">
            <h2>Admin Upload Pipeline</h2>
            <form onSubmit={uploadSelectedFiles} className="stack">
              <label>
                Delivery ID
                <input
                  value={uploadDeliveryId}
                  onChange={(event) => setUploadDeliveryId(event.target.value)}
                  placeholder="UUID delivery id"
                  required
                />
              </label>
              <label>
                Files
                <input
                  type="file"
                  multiple
                  onChange={(event) => setUploadQueue(Array.from(event.target.files ?? []))}
                  required
                />
              </label>
              <button type="submit" disabled={isUploading || uploadQueue.length === 0}>
                {isUploading ? 'Uploading...' : 'Upload Files'}
              </button>
            </form>

            <div className="stack">
              {uploadRecords.map((record) => (
                <div className="card compact" key={record.fileName}>
                  <div className="row between">
                    <strong>{record.fileName}</strong>
                    <span>{record.progress}%</span>
                  </div>
                  <progress max={100} value={record.progress} />
                  <p className={record.status === 'failed' ? 'error' : 'muted'}>
                    {record.message} ({record.status})
                  </p>
                </div>
              ))}
              {uploadRecords.length === 0 ? (
                <p className="muted">Select files to start browser-to-R2 upload.</p>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </main>
  )
}

export default App
