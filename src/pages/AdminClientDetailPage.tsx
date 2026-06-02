import { useAdminClientDetail } from '../hooks/useAdminClientDetail'
import { DeleteConfirmationModal } from '../components/DeleteConfirmationModal'
import { AdminActivityPanel } from '../components/AdminActivityPanel'
import { AdminClientEditForm } from '../components/AdminClientEditForm'
import { AdminProjectCard } from '../components/AdminProjectCard'
import { AdminBulkActions } from '../components/AdminBulkActions'
import { AdminDetailToolbar } from '../components/AdminDetailToolbar'
import { AdminLightbox } from '../components/AdminLightbox'
import { RetentionPanel } from '../components/RetentionPanel'

export function AdminClientDetailPage() {
  const detail = useAdminClientDetail()

  // --- auth guard ---
  if (!detail.session?.user.id || detail.role !== 'admin') {
    return (
      <section className="portal-section admin-screen">
        <h2>Client folder</h2>
        <p className="portal-error">Only admin users can access this page.</p>
      </section>
    )
  }

  if (!detail.selectedAdminClient) {
    return (
      <section className="portal-section admin-screen">
        <div className="portal-head admin-screen-head">
          <div>
            <p className="eyebrow">Client folder</p>
            <h2>No client selected</h2>
            <p>Pick a client from the folder list to view their work.</p>
          </div>
          <button className="button ghost" type="button" onClick={() => { detail.navigate('/admin/clients') }}>
            Back to folders
          </button>
        </div>
      </section>
    )
  }

  const client = detail.selectedAdminClient

  // --- main render ---
  return (
    <>
      <section className="portal-section admin-screen">
        <div className="portal-head admin-screen-head">
          <div>
            <p className="eyebrow">Client folder</p>
            <h2>{client.full_name}</h2>
            <p>
              {client.email}
              {client.phone ? ` · ${client.phone}` : ''}
            </p>
          </div>
          <div className="admin-head-actions">
            <button className="button ghost" type="button" onClick={() => { detail.navigate('/admin/clients') }}>Back</button>
            <button className="button ghost" type="button" onClick={() => { detail.navigate('/upload') }}>Upload more</button>
            <button className="button ghost" type="button" onClick={() => detail.setAdminClientEditMode((current) => !current)}>
              {detail.adminClientEditMode ? 'Close edit' : 'Edit client'}
            </button>
            <button className="button ghost" type="button" onClick={() => void detail.handleDeleteAdminClient()}>Delete client</button>
          </div>
        </div>

        <div className="admin-detail-summary">
          <div className="admin-stat-card"><span>Projects</span><strong>{client.projectCount}</strong></div>
          <div className="admin-stat-card"><span>Files</span><strong>{client.assetCount}</strong></div>
          <div className="admin-stat-card"><span>Updated</span><strong>{new Date(client.latestUpdatedAt).toLocaleDateString()}</strong></div>
        </div>

        {detail.adminError && <p className="portal-error">{detail.adminError}</p>}

        <AdminDetailToolbar
          assetSearch={detail.adminAssetSearch}
          projectSort={detail.adminProjectSort}
          assetTypeFilter={detail.adminAssetTypeFilter}
          projectFilterId={detail.adminProjectFilterId}
          projects={client.projects}
          selectedCount={detail.selectedAdminAssetIds.length}
          visibleCount={detail.selectedAdminVisibleAssets.length}
          searchTrimmed={detail.adminAssetSearch.trim()}
          clientNotes={client.notes}
          onAssetSearchChange={detail.setAdminAssetSearch}
          onProjectSortChange={detail.setAdminProjectSort}
          onAssetTypeFilterChange={detail.setAdminAssetTypeFilter}
          onProjectFilterIdChange={detail.setAdminProjectFilterId}
        />

        <AdminActivityPanel
          title="Recent activity"
          activities={detail.activities}
          busy={detail.activityBusy}
          error={detail.activityError instanceof Error ? detail.activityError.message : detail.activityError ? String(detail.activityError) : ''}
          kindFilter={detail.kindFilter}
          onKindFilterChange={detail.setKindFilter}
          expanded={detail.activityExpanded}
          onToggleExpanded={() => detail.setActivityExpanded((prev) => !prev)}
          contextHint="Showing activity for the selected client folder."
          getContext={detail.getAdminActivityContext}
        />

        <AdminBulkActions
          selectedCount={detail.selectedAdminAssetIds.length}
          visibleCount={detail.selectedAdminVisibleAssets.length}
          busy={detail.adminBusy}
          actionMessage={detail.adminActionMessage}
          onSelectVisible={detail.selectVisibleAdminAssets}
          onClearSelection={detail.clearSelectedAdminAssets}
          onDownloadSelected={() => void detail.handleDownloadSelectedAdminAssets()}
          onDeleteSelected={() => void detail.handleBulkDeleteAdminAssets()}
        />

        {detail.adminClientEditMode && (
          <AdminClientEditForm
            draft={detail.adminClientDraft}
            onDraftChange={detail.setAdminClientDraft}
            onSave={() => void detail.handleSaveAdminClient()}
            onCancel={detail.handleCancelEdit}
            busy={detail.adminBusy}
          />
        )}

        <div className="admin-project-stack">
          {detail.selectedAdminClientProjectViews.length === 0 ? (
            <p className="portal-hint">
              {client.projects.length === 0
                ? 'No projects yet for this client.'
                : 'No files match the current filters.'}
            </p>
          ) : (
            detail.selectedAdminClientProjectViews.map(({ project, totalAssets, visibleAssets, latestActivityAt }) => (
              <AdminProjectCard
                key={project.id}
                project={project}
                totalAssets={totalAssets}
                visibleAssets={visibleAssets}
                latestActivityAt={latestActivityAt}
                selectedAssetIds={detail.selectedAdminAssetIds}
                previewUrls={detail.adminAssetPreviewUrls}
                onToggleAssetSelection={detail.toggleSelectedAdminAsset}
                onOpenLightbox={(pid, aid) => void detail.openAdminLightbox(pid, aid)}
                onDownloadAsset={(aid) => void detail.handleOpenAsset(aid, 'download')}
                onDeleteAsset={detail.handleDeleteAdminAsset}
                onDownloadProject={(p) => void detail.handleDownloadAdminProject(p)}
                onDeleteProject={detail.handleDeleteAdminProject}
                onLoadMore={detail.loadMoreAdminProjectAssets}
              />
            ))
          )}
        </div>

        {detail.adminLightboxAsset && detail.adminLightbox && (
          <AdminLightbox
            asset={detail.adminLightboxAsset}
            previewUrl={detail.adminAssetPreviewUrls[detail.adminLightboxAsset.id]}
            index={detail.adminLightboxIndex}
            total={detail.adminLightboxAssets.length}
            onClose={detail.closeAdminLightbox}
            onMove={detail.moveAdminLightbox}
            onDownload={(assetId) => void detail.handleOpenAsset(assetId, 'download')}
          />
        )}
      </section>

      <RetentionPanel clientId={client.id} />

      {detail.deleteConfirmation && (
        <DeleteConfirmationModal
          title={detail.deleteConfirmation.title}
          description={detail.deleteConfirmation.description}
          confirmLabel={detail.deleteConfirmation.confirmLabel}
          busy={detail.adminBusy}
          onConfirm={() => void detail.confirmDeleteConfirmation()}
          onCancel={detail.closeDeleteConfirmation}
        />
      )}
    </>
  )
}
