import { useCallback, useEffect, useReducer, useState } from 'react'
import type { AdminActivityItem } from '../types'
import { useAuth } from '../hooks/useAuth'
import { workerRequest } from '../hooks/useApi'
import { useAdminData } from '../context/AdminDataContext.tsx'
import { ADMIN_ACTIVITY_LIMIT } from '../lib/helpers'
import { supabase } from '../lib/supabase'
import { AdminActivityPanel } from '../components/AdminActivityPanel'
import { adminActivityReducer, createAdminActivityInitialState } from '../reducers/adminActivityReducer'
import { SkeletonCardList } from '../components/Skeleton'

export function AdminClientsPage() {
  const { session, role, getAccessToken } = useAuth()
  const {
    adminClients,
    adminBusy,
    adminError,
    adminClientById,
    adminProjectById,
    adminAssetById,
  } = useAdminData()

  const [adminClientSearch, setAdminClientSearch] = useState('')
  const [activityState, activityDispatch] = useReducer(adminActivityReducer, true, createAdminActivityInitialState)

  // --- Load admin activity on mount ---

  useEffect(() => {
    if (!supabase || !session?.user.id || role !== 'admin') return

    let cancelled = false

    const loadAdminActivity = async () => {
      activityDispatch({ type: 'SET_BUSY', busy: true })
      activityDispatch({ type: 'SET_ERROR', error: '' })

      try {
        const token = await getAccessToken()
        if (cancelled) return
        if (!token) {
          activityDispatch({ type: 'SET_ERROR', error: 'Login session expired. Please log in again.' })
          return
        }

        const params = new URLSearchParams({ limit: String(ADMIN_ACTIVITY_LIMIT) })

        const payload = await workerRequest<{ activities: AdminActivityItem[] }>(
          `/api/v1/admin/activity?${params.toString()}`,
          token
        )
        if (!cancelled) {
          activityDispatch({ type: 'SET_ACTIVITIES', activities: payload.activities ?? [] })
        }
      } catch (error) {
        if (!cancelled) {
          activityDispatch({ type: 'SET_ERROR', error: error instanceof Error ? error.message : 'Failed to load activity trail' })
        }
      } finally {
        if (!cancelled) {
          activityDispatch({ type: 'SET_BUSY', busy: false })
        }
      }
    }

    void loadAdminActivity()

    return () => {
      cancelled = true
    }
  }, [role, session?.user.id, getAccessToken])

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
            window.location.hash = '#/upload'
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
        activities={activityState.activities}
        busy={activityState.busy}
        error={activityState.error}
        kindFilter={activityState.kindFilter}
        onKindFilterChange={(filter) => activityDispatch({ type: 'SET_KIND_FILTER', filter })}
        expanded={activityState.expanded}
        onToggleExpanded={() => activityDispatch({ type: 'TOGGLE_EXPANDED' })}
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
              window.location.hash = '#/admin/clients/' + client.id
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
