import type { AdminProject } from '../types'

interface AdminDetailToolbarProps {
  assetSearch: string
  projectSort: 'recent' | 'name' | 'files'
  assetTypeFilter: 'all' | 'images' | 'videos' | 'other'
  projectFilterId: string
  projects: AdminProject[]
  selectedCount: number
  visibleCount: number
  searchTrimmed: string
  clientNotes: string | null
  onAssetSearchChange: (value: string) => void
  onProjectSortChange: (value: 'recent' | 'name' | 'files') => void
  onAssetTypeFilterChange: (value: 'all' | 'images' | 'videos' | 'other') => void
  onProjectFilterIdChange: (value: string) => void
}

export function AdminDetailToolbar({
  assetSearch,
  projectSort,
  assetTypeFilter,
  projectFilterId,
  projects,
  selectedCount,
  visibleCount,
  searchTrimmed,
  clientNotes,
  onAssetSearchChange,
  onProjectSortChange,
  onAssetTypeFilterChange,
  onProjectFilterIdChange,
}: AdminDetailToolbarProps) {
  return (
    <div className="admin-detail-toolbar">
      <label className="admin-search">
        Search files
        <input
          type="search"
          value={assetSearch}
          onChange={(event) => onAssetSearchChange(event.target.value)}
          placeholder="Search by filename, type, or project"
        />
      </label>

      <label className="admin-search">
        Sort folders
        <select value={projectSort} onChange={(event) => onProjectSortChange(event.target.value as typeof projectSort)}>
          <option value="recent">Recent activity</option>
          <option value="name">Name</option>
          <option value="files">File count</option>
        </select>
      </label>

      <label className="admin-search">
        Media type
        <select
          value={assetTypeFilter}
          onChange={(event) => onAssetTypeFilterChange(event.target.value as typeof assetTypeFilter)}
        >
          <option value="all">All files</option>
          <option value="images">Images</option>
          <option value="videos">Videos</option>
          <option value="other">Other files</option>
        </select>
      </label>

      <label className="admin-search">
        Project
        <select value={projectFilterId} onChange={(event) => onProjectFilterIdChange(event.target.value)}>
          <option value="all">All projects</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>

      <div className="admin-detail-toolbar-copy">
        <p className="portal-hint">
          {selectedCount > 0
            ? `${selectedCount} selected file${selectedCount === 1 ? '' : 's'}`
            : `${visibleCount} loaded file${visibleCount === 1 ? '' : 's'}`}
          {searchTrimmed ? ` matching "${searchTrimmed}"` : ''}
        </p>
        {clientNotes && <p className="portal-hint">{clientNotes}</p>}
      </div>
    </div>
  )
}
