import { useEffect, useMemo, useState } from 'react'
import type { AdminActivityKind, AdminActivityItem } from '../types'
import { useAuth } from '../hooks/useAuth'
import { workerRequest } from '../hooks/useApi'
import { useAdminData } from '../context/AdminDataContext.tsx'
import { ADMIN_ACTIVITY_LIMIT } from '../lib/helpers'
import { getDisplayFileName } from '../lib/upload'
import { supabase } from '../lib/supabase'

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
  const [adminActivities, setAdminActivities] = useState<AdminActivityItem[]>([])
  const [adminActivityBusy, setAdminActivityBusy] = useState(false)
  const [adminActivityError, setAdminActivityError] = useState('')
  const [adminActivityKindFilter, setAdminActivityKindFilter] = useState<'all' | AdminActivityKind>('all')
  const [adminActivityExpanded, setAdminActivityExpanded] = useState(true)

  // --- Load admin activity on mount ---

  useEffect(() => {
    if (!supabase || !session?.user.id || role !== 'admin') return

    let cancelled = false

    const loadAdminActivity = async () => {
      setAdminActivityBusy(true)
      setAdminActivityError('')

      try {
        const token = await getAccessToken()
        if (cancelled) return
        if (!token) {
          setAdminActivityError('Login session expired. Please log in again.')
          return
        }

        const params = new URLSearchParams({ limit: String(ADMIN_ACTIVITY_LIMIT) })

        const payload = await workerRequest<{ activities: AdminActivityItem[] }>(
          `/api/v1/admin/activity?${params.toString()}`,
          token
        )
        if (!cancelled) {
          setAdminActivities(payload.activities ?? [])
        }
      } catch (error) {
        if (!cancelled) {
          setAdminActivityError(error instanceof Error ? error.message : 'Failed to load activity trail')
        }
      } finally {
        if (!cancelled) {
          setAdminActivityBusy(false)
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

  const getAdminActivityContext = (entry: AdminActivityItem) => {
    const client = entry.clientId ? adminClientById.get(entry.clientId) : null
    const project = entry.projectId ? adminProjectById.get(entry.projectId) : null
    const asset = entry.assetId ? adminAssetById.get(entry.assetId) : null
    const itemCount = typeof entry.metadata?.count === 'number' ? entry.metadata.count : null

    return { client, project, asset, itemCount }
  }

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
      const kindMatches = adminActivityKindFilter === 'all' || entry.kind === adminActivityKindFilter
      return kindMatches
    })
  }, [adminActivities, adminActivityKindFilter])

  // --- Activity panel ---

  const renderAdminActivityPanel = (title: string) => (
    <section className="admin-activity-panel">
      <div className="admin-activity-panel-head">
        <div>
          <p className="eyebrow">Audit trail</p>
          <h3>{title}</h3>
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

      {renderAdminActivityPanel('Recent activity')}

      {adminBusy && <p className="portal-hint">Loading client folders...</p>}
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
