import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AdminActivityItem, AdminActivityKind } from '../types'
import { useAuth } from '../hooks/useAuth'
import { useAdminData } from '../context/AdminDataContext.tsx'
import { useAdminActivity } from '../hooks/queries/useAdminActivity'
import { AdminActivityPanel } from '../components/AdminActivityPanel'
import { SkeletonCardList } from '../components/Skeleton'

export function AdminClientsPage() {
  const navigate = useNavigate()
  const { session, role } = useAuth()
  const {
    adminClients,
    adminBusy,
    adminError,
    adminClientById,
    adminProjectById,
    adminAssetById,
  } = useAdminData()

  const [adminClientSearch, setAdminClientSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | AdminActivityKind>('all')
  const [expanded, setExpanded] = useState(true)

  const { data: activities = [], isLoading: activityBusy, error: activityError } = useAdminActivity()

  // --- Computed values ---

  const filteredAdminClients = adminClients.filter((client) => {
    const query = adminClientSearch.trim().toLowerCase()
    if (!query) return true
    return [client.full_name, client.email, client.notes ?? '', client.projects.map((project) => project.name).join(' ')]
      .join(' ')
      .toLowerCase()
      .includes(query)
  })

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

  // --- Auth guard ---

  if (!session?.user.id || role !== 'admin') {
    return (
      <section className="portal-section admin-screen">
        <h2>Client folders</h2>
        <p className="portal-error">Only admin users can access this page.</p>
      </section>
    )
  }

  // --- Main render ---

  return (
    <section className="portal-section admin-screen">
      <div className="portal-head admin-screen-head">
        <div>
          <p className="eyebrow">Admin view</p>
          <h2>Client folders</h2>
          <p>Open a client to review folders and assets without the interface getting in the way.</p>
        </div>
        <button
          className="button ghost"
          type="button"
          onClick={() => {
            navigate('/upload')
          }}
        >
          New upload
        </button>
      </div>

      <div className="admin-stat-grid">
        <div className="admin-stat-card">
          <span>Clients</span>
          <strong>{adminClients.length}</strong>
        </div>
        <div className="admin-stat-card">
          <span>Projects</span>
          <strong>{adminClients.reduce((count, client) => count + client.projectCount, 0)}</strong>
        </div>
        <div className="admin-stat-card">
          <span>Files</span>
          <strong>{adminClients.reduce((count, client) => count + client.assetCount, 0)}</strong>
        </div>
      </div>

      <label className="admin-search">
        Search clients
        <input
          type="search"
          value={adminClientSearch}
          onChange={(event) => setAdminClientSearch(event.target.value)}
          placeholder="Search by client, email, or project"
        />
      </label>

      <AdminActivityPanel
        title="Recent activity"
        activities={activities}
        busy={activityBusy}
        error={activityError instanceof Error ? activityError.message : activityError ? String(activityError) : ''}
        kindFilter={kindFilter}
        onKindFilterChange={setKindFilter}
        expanded={expanded}
        onToggleExpanded={() => setExpanded((prev) => !prev)}
        getContext={getAdminActivityContext}
      />

      {adminBusy && <SkeletonCardList count={4} />}
      {adminError && <p className="portal-error">{adminError}</p>}
      {!adminBusy && !adminError && filteredAdminClients.length === 0 && (
        <p className="portal-hint">No client folders found yet.</p>
      )}

      <div className="admin-client-grid">
        {filteredAdminClients.map((client) => (
          <button
            key={client.id}
            className="admin-client-card"
            type="button"
            onClick={() => {
              navigate('/admin/clients/' + client.id)
            }}
          >
            <div className="admin-client-card-head">
              <div>
                <p className="delivery-title">{client.full_name}</p>
                <p className="delivery-expiry">{client.email}</p>
              </div>
              <span className="admin-client-count">{client.assetCount} files</span>
            </div>
            <div className="admin-client-meta">
              <span>{client.projectCount} project{client.projectCount === 1 ? '' : 's'}</span>
              <span>Updated {new Date(client.latestUpdatedAt).toLocaleDateString()}</span>
            </div>
            <div className="admin-client-preview">
              {client.assets.slice(0, 3).map((asset) => (
                <span key={asset.id}>{asset.filename}</span>
              ))}
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}
