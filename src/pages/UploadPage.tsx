import { useUpload } from '../hooks/useUpload'

export function UploadPage() {
  const {
    session,
    role,
    adminBusy,
    adminError,
    uploadClientMode,
    uploadEmail,
    uploadReuseSearch,
    uploadTitle,
    uploadItems,
    uploadDropActive,
    uploadBusy,
    uploadMessage,
    uploadInputRef,
    selectedUploadClient,
    filteredReuseClientEmailOptions,
    reuseClientEmailOptions,
    uploadQueueGroups,
    dispatch,
    handleFilesChange,
    handleBrowseClick,
    handleDrop,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDelivery,
  } = useUpload()

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
              ? `${uploadQueueGroups.filter((g) => g.isFolder).length} folder group${
                  uploadQueueGroups.filter((g) => g.isFolder).length === 1 ? '' : 's'
                }, ${uploadQueueGroups.filter((g) => !g.isFolder).length} file group${
                  uploadQueueGroups.filter((g) => !g.isFolder).length === 1 ? '' : 's'
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

      <form className="admin-upload-layout" onSubmit={handleDelivery}>
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
              onChange={(e) => dispatch({ type: 'SET_EMAIL', email: e.target.value })}
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
                  onChange={(e) => dispatch({ type: 'SET_REUSE_SEARCH', search: e.target.value })}
                  placeholder="Search by name or email"
                />
              </label>
              <label>
                Existing client email
                <select
                  value={selectedUploadClient?.email ?? ''}
                  onChange={(e) => dispatch({ type: 'SET_EMAIL', email: e.target.value })}
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
                <p className="portal-hint">No existing clients match the search. Clear the search or type an email manually.</p>
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
              onChange={(e) => dispatch({ type: 'SET_TITLE', title: e.target.value })}
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
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            role="presentation"
          >
            <input
              ref={uploadInputRef}
              className="admin-dropzone-input"
              type="file"
              multiple
              onChange={handleFilesChange}
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
              <button className="button ghost" type="button" onClick={handleBrowseClick}>
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
