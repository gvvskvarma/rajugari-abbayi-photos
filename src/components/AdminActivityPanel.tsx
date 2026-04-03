import { useMemo } from 'react'
import type { AdminActivityItem, AdminActivityKind, AdminClient, AdminProject, AdminAsset } from '../types'
import { getDisplayFileName } from '../lib/upload'

export type AdminActivityContext = {
  client: AdminClient | null | undefined
  project: AdminProject | null | undefined
  asset: AdminAsset | null | undefined
  itemCount: number | null
}

export type AdminActivityPanelProps = {
  title: string
  activities: AdminActivityItem[]
  busy: boolean
  error: string
  kindFilter: 'all' | AdminActivityKind
  onKindFilterChange: (filter: 'all' | AdminActivityKind) => void
  expanded: boolean
  onToggleExpanded: () => void
  contextHint?: string
  getContext: (entry: AdminActivityItem) => AdminActivityContext
}

export function AdminActivityPanel({
  title,
  activities,
  busy,
  error,
  kindFilter,
  onKindFilterChange,
  expanded,
  onToggleExpanded,
  contextHint,
  getContext,
}: AdminActivityPanelProps) {
  const activityCounts = useMemo(() => {
    const counts: Record<'all' | AdminActivityKind, number> = {
      all: 0,
      upload: 0,
      download: 0,
      create: 0,
      edit: 0,
      delete: 0,
    }

    for (const activity of activities) {
      counts.all += 1
      counts[activity.kind] += 1
    }

    return counts
  }, [activities])

  const visibleActivities = useMemo(() => {
    return activities.filter((entry) => {
      return kindFilter === 'all' || entry.kind === kindFilter
    })
  }, [activities, kindFilter])

  return (
    <section className="admin-activity-panel">
      <div className="admin-activity-panel-head">
        <div>
          <p className="eyebrow">Audit trail</p>
          <h3>{title}</h3>
        </div>
        <div className="admin-activity-panel-head-actions">
          <span className="admin-client-count">{visibleActivities.length} events</span>
          <button
            className="button ghost"
            type="button"
            onClick={onToggleExpanded}
          >
            {expanded ? 'Hide activity' : 'Show activity'}
          </button>
        </div>
      </div>

      {expanded && (
        <>
          <div className="admin-activity-toolbar" role="toolbar" aria-label="Audit trail filters">
            <button
              className={`button ghost admin-activity-chip ${kindFilter === 'all' ? 'is-active' : ''}`}
              type="button"
              onClick={() => onKindFilterChange('all')}
            >
              All events
              <span>{activityCounts.all}</span>
            </button>
            <button
              className={`button ghost admin-activity-chip ${kindFilter === 'upload' ? 'is-active' : ''}`}
              type="button"
              onClick={() => onKindFilterChange('upload')}
            >
              Uploads
              <span>{activityCounts.upload}</span>
            </button>
            <button
              className={`button ghost admin-activity-chip ${kindFilter === 'download' ? 'is-active' : ''}`}
              type="button"
              onClick={() => onKindFilterChange('download')}
            >
              Downloads
              <span>{activityCounts.download}</span>
            </button>
            <button
              className={`button ghost admin-activity-chip ${kindFilter === 'create' ? 'is-active' : ''}`}
              type="button"
              onClick={() => onKindFilterChange('create')}
            >
              Creates
              <span>{activityCounts.create}</span>
            </button>
            <button
              className={`button ghost admin-activity-chip ${kindFilter === 'edit' ? 'is-active' : ''}`}
              type="button"
              onClick={() => onKindFilterChange('edit')}
            >
              Edits
              <span>{activityCounts.edit}</span>
            </button>
            <button
              className={`button ghost admin-activity-chip ${kindFilter === 'delete' ? 'is-active' : ''}`}
              type="button"
              onClick={() => onKindFilterChange('delete')}
            >
              Deletes
              <span>{activityCounts.delete}</span>
            </button>
          </div>

          {contextHint && <p className="portal-hint">{contextHint}</p>}
          {busy ? (
            <p className="portal-hint">Loading recent activity...</p>
          ) : error ? (
            <p className="portal-error">{error}</p>
          ) : visibleActivities.length === 0 ? (
            <p className="portal-hint">No recent activity yet.</p>
          ) : (
            <ul className="admin-activity-list">
              {visibleActivities.slice(0, 6).map((entry) => (
                <li key={entry.id} className={`admin-activity-item is-${entry.kind}`}>
                  {(() => {
                    const { client, project, asset, itemCount } = getContext(entry)
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
}
