interface AdminBulkActionsProps {
  selectedCount: number
  visibleCount: number
  busy: boolean
  actionMessage: string
  onSelectVisible: () => void
  onClearSelection: () => void
  onDownloadSelected: () => void
  onDeleteSelected: () => void
}

export function AdminBulkActions({
  selectedCount,
  visibleCount,
  busy,
  actionMessage,
  onSelectVisible,
  onClearSelection,
  onDownloadSelected,
  onDeleteSelected,
}: AdminBulkActionsProps) {
  return (
    <div className="admin-bulk-actions" aria-live="polite">
      <div className="admin-bulk-actions-copy">
        <p className="admin-bulk-actions-title">
          {selectedCount > 0
            ? `${selectedCount} selected file${selectedCount === 1 ? '' : 's'}`
            : `${visibleCount} visible file${visibleCount === 1 ? '' : 's'}`}
        </p>
        <p className="admin-bulk-actions-status">
          {actionMessage || 'Bulk actions stay pinned while you scroll through the folder.'}
        </p>
      </div>
      <div className="admin-bulk-actions-buttons">
        <button
          className="button ghost"
          type="button"
          onClick={onSelectVisible}
          disabled={busy || visibleCount === 0}
        >
          Select visible
        </button>
        <button
          className="button ghost"
          type="button"
          onClick={onClearSelection}
          disabled={busy || selectedCount === 0}
        >
          Clear selection
        </button>
        <button
          className="button ghost"
          type="button"
          onClick={onDownloadSelected}
          disabled={busy || selectedCount === 0}
        >
          Download selected
        </button>
        <button
          className="button ghost"
          type="button"
          onClick={onDeleteSelected}
          disabled={busy || selectedCount === 0}
        >
          Delete selected
        </button>
      </div>
    </div>
  )
}
