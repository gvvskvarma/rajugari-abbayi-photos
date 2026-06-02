import type { AdminAsset, AdminProject } from '../types'
import { getDisplayFileName } from '../lib/upload'

interface AdminProjectCardProps {
  project: AdminProject
  totalAssets: number
  visibleAssets: AdminAsset[]
  latestActivityAt: string
  selectedAssetIds: string[]
  previewUrls: Record<string, string>
  onToggleAssetSelection: (assetId: string) => void
  onOpenLightbox: (projectId: string, assetId: string) => void
  onDownloadAsset: (assetId: string) => void
  onDeleteAsset: (assetId: string) => void
  onDownloadProject: (project: AdminProject) => void
  onDeleteProject: (project: AdminProject) => void
  onLoadMore: (projectId: string) => void
}

export function AdminProjectCard({
  project,
  totalAssets,
  visibleAssets,
  latestActivityAt,
  selectedAssetIds,
  previewUrls,
  onToggleAssetSelection,
  onOpenLightbox,
  onDownloadAsset,
  onDeleteAsset,
  onDownloadProject,
  onDeleteProject,
  onLoadMore,
}: AdminProjectCardProps) {
  return (
    <article className="admin-project-card">
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
          <button className="button ghost" type="button" onClick={() => onDownloadProject(project)}>
            Download folder
          </button>
          <button className="button ghost" type="button" onClick={() => onDeleteProject(project)}>
            Delete folder
          </button>
        </div>
      </div>

      {visibleAssets.length === 0 ? (
        <p className="portal-hint">No files in this project match the current search.</p>
      ) : (
        <div className="admin-asset-grid">
          {visibleAssets.map((asset) => {
            const isSelected = selectedAssetIds.includes(asset.id)
            const previewUrl = previewUrls[asset.id]
            const isImage = asset.mime_type.startsWith('image/')
            const displayName = getDisplayFileName(asset.filename)
            return (
              <article key={asset.id} className={`admin-asset-card ${isSelected ? 'is-selected' : ''}`}>
                <button
                  className="admin-asset-select"
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onToggleAssetSelection(asset.id)}
                >
                  <span className="admin-asset-checkbox">{isSelected ? '\u2713' : ''}</span>
                  <span className="sr-only">Select {displayName}</span>
                </button>
                {isImage ? (
                  <button
                    className="admin-asset-thumb admin-asset-thumb-button"
                    type="button"
                    onClick={() => onOpenLightbox(project.id, asset.id)}
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
                  {asset.folder && <span className="admin-asset-folder">📁 {asset.folder}</span>}
                </div>
                <div className="delivery-asset-actions">
                  <button
                    className="button ghost"
                    type="button"
                    onClick={() => onDownloadAsset(asset.id)}
                  >
                    Download
                  </button>
                  <button
                    className="button ghost"
                    type="button"
                    onClick={() => onDeleteAsset(asset.id)}
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
            onClick={() => onLoadMore(project.id)}
          >
            Load more
          </button>
        </div>
      )}
      <p className="portal-hint admin-project-updated">Last activity {new Date(latestActivityAt).toLocaleString()}</p>
    </article>
  )
}
