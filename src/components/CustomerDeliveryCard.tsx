import { useMemo, useState } from 'react'
import type { useMyPictures } from '../hooks/useMyPictures'
import type { DeliveryAsset, DeliveryCard as DeliveryCardType } from '../types'
import { groupAssetsByFolder, UNGROUPED_KEY } from '../lib/folders'
import { getDisplayFileName, sanitizeDownloadName } from '../lib/upload'
import { splitIntoDownloadParts, formatBytes } from '../lib/downloadParts'
import { getAssetKind } from '../lib/helpers'

type Pics = ReturnType<typeof useMyPictures>

/**
 * Download control that auto-splits large sets into size-capped parts. Each
 * part is a separate request (fresh memory + CPU budget), so big galleries
 * download reliably even on Cloudflare's Free plan. Under the cap it's a
 * single button, exactly as before.
 */
function DownloadButtons({
  assets,
  deliveryId,
  baseName,
  label,
  pics,
}: {
  assets: DeliveryAsset[]
  deliveryId: string
  baseName: string
  label: string
  pics: Pics
}) {
  const parts = useMemo(() => splitIntoDownloadParts(assets), [assets])
  const safeBase = sanitizeDownloadName(baseName || 'photos')

  if (assets.length === 0) return null

  if (parts.length <= 1) {
    return (
      <button
        className="button ghost"
        type="button"
        disabled={pics.actionBusy}
        onClick={() => pics.handleDownloadPart(deliveryId, parts[0]?.assetIds ?? assets.map((a) => a.id), `${safeBase}.zip`)}
      >
        {pics.actionBusy ? 'Working…' : label}
      </button>
    )
  }

  return (
    <span className="download-parts">
      <span className="download-parts-note">
        {label} — large gallery, split into {parts.length} parts:
      </span>
      {parts.map((p) => (
        <button
          key={p.index}
          className="button ghost"
          type="button"
          disabled={pics.actionBusy}
          onClick={() => pics.handleDownloadPart(deliveryId, p.assetIds, `${safeBase}-part-${p.index}-of-${p.total}.zip`)}
        >
          Part {p.index} of {p.total} ({formatBytes(p.bytes)})
        </button>
      ))}
    </span>
  )
}

/**
 * One delivery in the client gallery. When the delivery's files span multiple
 * folders (e.g. the photographer dragged in "Ceremony" + "Reception"), the
 * client first sees a folder grid and drills into one folder at a time —
 * mirroring exactly what was uploaded. Single-folder / legacy deliveries
 * render flat, with the full select / download / share action bar unchanged.
 */
export function CustomerDeliveryCard({ delivery, pics }: { delivery: DeliveryCardType; pics: Pics }) {
  const [activeFolderKey, setActiveFolderKey] = useState<string | null>(null)
  const canAct = delivery.accessMode !== 'viewer'
  const isSelectMode = pics.selectDeliveryId === delivery.deliveryId

  const { groups, hasFolders } = useMemo(() => groupAssetsByFolder(delivery.assets), [delivery.assets])
  const activeGroup = activeFolderKey ? groups.find((g) => g.key === activeFolderKey) ?? null : null

  const deliveryName = delivery.projectName || delivery.clientName || 'photos'
  const folderLabel = (key: string, name: string | null) => (key === UNGROUPED_KEY || !name ? 'Unsorted' : name)

  /* Per-asset tile — shared between flat and folder-detail grids. `selectable`
     enables the delivery-level select overlay (flat view only). */
  const renderAsset = (asset: DeliveryAsset, selectable: boolean) => {
    const isSelected = selectable && isSelectMode && pics.selectedAssetSet.has(asset.id)
    const displayName = getDisplayFileName(asset.filename)
    const isImage = asset.mime_type.startsWith('image/')
    const thumbnailUrl = pics.customerThumbnailUrls[asset.id]
    const selecting = selectable && isSelectMode

    return (
      <article key={asset.id} className={`customer-asset-card ${isSelected ? 'is-selected' : ''}`}>
        {selecting && (
          <button className="customer-asset-select-overlay" type="button" aria-pressed={isSelected}
            onClick={() => pics.toggleAsset(asset.id)} disabled={pics.actionBusy}>
            <span className="customer-asset-check">{isSelected ? '✓' : ''}</span>
            <span className="sr-only">Select {displayName}</span>
          </button>
        )}
        {isImage ? (
          <button className="customer-asset-thumb customer-asset-thumb-button" type="button"
            onClick={() => selecting ? pics.toggleAsset(asset.id) : pics.openCustomerLightbox(delivery.deliveryId, asset.id)}
            aria-label={selecting ? `Select ${displayName}` : `Open ${displayName}`}
            disabled={!selecting && !thumbnailUrl}>
            {thumbnailUrl ? (
              <img src={thumbnailUrl} alt={displayName} loading="lazy" decoding="async" />
            ) : (
              <div className="customer-asset-thumb-fallback"><span>IMG</span></div>
            )}
          </button>
        ) : (
          <div className="customer-asset-thumb">
            <div className="customer-asset-thumb-fallback">
              <span>{asset.mime_type.split('/')[0]?.slice(0, 1).toUpperCase() || 'F'}</span>
            </div>
          </div>
        )}
        <div className="customer-asset-main">
          {!isImage && (
            <>
              <p className="customer-asset-name">{displayName}</p>
              <p className="portal-hint">{getAssetKind(asset.mime_type)}</p>
            </>
          )}
        </div>
        {!selecting && (
          <div className="customer-asset-actions">
            {!isImage && (
              <button className="button ghost" type="button" onClick={() => { void pics.handleOpenAsset(asset.id, 'view') }}>Open</button>
            )}
            <button className="button ghost" type="button" disabled={!asset.canDownload} onClick={() => { void pics.handleOpenAsset(asset.id, 'download') }}>Download</button>
          </div>
        )}
      </article>
    )
  }

  const shareLinkRow = pics.newShareLinks[delivery.deliveryId] && (
    <div className="share-link-row">
      <div className="share-link-meta">
        <span className="share-link-label">
          {pics.newShareLinkScopes[delivery.deliveryId] === 'selected' ? 'Selected files only' : 'All files in this folder'}
        </span>
      </div>
      <input className="share-link-input" value={pics.newShareLinks[delivery.deliveryId]} readOnly />
      <button className="button ghost" type="button" onClick={() => { void pics.handleCopyShareLink(delivery.deliveryId) }}>
        {pics.shareCopyState[delivery.deliveryId] || 'Copy'}
      </button>
    </div>
  )

  return (
    <article className="delivery-card">
      <div className="delivery-header">
        <div>
          <p className="delivery-title">{delivery.projectName || delivery.clientName || 'Your gallery'}</p>
          <p className="delivery-expiry">
            {delivery.projectStatus
              ? delivery.projectStatus.charAt(0).toUpperCase() + delivery.projectStatus.slice(1)
              : delivery.accessMode === 'viewer' ? 'View only' : 'Available now'}
          </p>
        </div>
        <div className="delivery-header-actions">
          <span className="admin-client-count">{delivery.assets.length} file{delivery.assets.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      {/* ── Folder grid (multi-folder delivery, nothing drilled into) ── */}
      {hasFolders && !activeGroup && (
        <>
          {canAct && (
            <div className="delivery-action-bar">
              <DownloadButtons assets={delivery.assets} deliveryId={delivery.deliveryId} baseName={deliveryName} label="Download everything" pics={pics} />
              <button className="button ghost" type="button" disabled={pics.actionBusy} onClick={() => pics.handleShareAll(delivery.deliveryId)}>Share everything</button>
            </div>
          )}
          {shareLinkRow}
          <div className="folder-grid">
            {groups.map((group) => {
              const cover = group.assets.find((a) => a.mime_type.startsWith('image/'))
              const coverUrl = cover ? pics.customerThumbnailUrls[cover.id] : undefined
              return (
                <button key={group.key} type="button" className="folder-card" onClick={() => setActiveFolderKey(group.key)}>
                  <span className="folder-card-cover">
                    {coverUrl ? <img src={coverUrl} alt="" loading="lazy" decoding="async" /> : <span className="folder-card-icon">📁</span>}
                  </span>
                  <span className="folder-card-meta">
                    <strong>{folderLabel(group.key, group.name)}</strong>
                    <span className="portal-hint">{group.assets.length} file{group.assets.length === 1 ? '' : 's'}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* ── Folder detail (drilled into one folder) ── */}
      {hasFolders && activeGroup && (
        <>
          <div className="folder-detail-head">
            <button className="button ghost" type="button" onClick={() => setActiveFolderKey(null)}>← All folders</button>
            <strong>{folderLabel(activeGroup.key, activeGroup.name)}</strong>
            {canAct && (
              <span className="folder-detail-actions">
                <DownloadButtons
                  assets={activeGroup.assets}
                  deliveryId={delivery.deliveryId}
                  baseName={`${deliveryName} - ${folderLabel(activeGroup.key, activeGroup.name)}`}
                  label="Download this folder"
                  pics={pics}
                />
                <button className="button ghost" type="button" disabled={pics.actionBusy}
                  onClick={() => pics.handleShareAssets(delivery.deliveryId, activeGroup.assets.map((a) => a.id))}>
                  Share this folder
                </button>
              </span>
            )}
          </div>
          {pics.actionMessage && pics.selectDeliveryId === delivery.deliveryId && <p className="portal-error">{pics.actionMessage}</p>}
          {shareLinkRow}
          <div className="customer-asset-grid">
            {activeGroup.assets.map((asset) => renderAsset(asset, false))}
          </div>
        </>
      )}

      {/* ── Flat delivery (no meaningful folders) — original behaviour ── */}
      {!hasFolders && (
        <>
          {canAct && (
            <div className="delivery-action-bar">
              {isSelectMode ? (
                <>
                  <button className="button ghost" type="button" onClick={() => pics.selectAllAssets(delivery.deliveryId)} disabled={pics.actionBusy}>Select all</button>
                  <button className="button ghost" type="button" onClick={pics.clearSelection} disabled={pics.actionBusy || pics.selectedCount === 0}>Clear</button>
                  <button className="button ghost" type="button" onClick={pics.handleDownloadSelected} disabled={pics.actionBusy || pics.selectedCount === 0}>
                    {pics.actionBusy ? 'Working...' : `Download selected (${pics.selectedCount})`}
                  </button>
                  <button className="button ghost" type="button" onClick={pics.handleShareSelected} disabled={pics.actionBusy || pics.selectedCount === 0}>
                    {pics.actionBusy ? 'Working...' : `Create share link with selected files (${pics.selectedCount})`}
                  </button>
                  <button className="button ghost" type="button" onClick={pics.exitSelectMode} disabled={pics.actionBusy}>Cancel</button>
                </>
              ) : (
                <>
                  <DownloadButtons assets={delivery.assets} deliveryId={delivery.deliveryId} baseName={deliveryName} label="Download all" pics={pics} />
                  <button className="button ghost" type="button" disabled={pics.actionBusy} onClick={() => pics.startSelectMode(delivery.deliveryId)}>Select files</button>
                  <button className="button ghost" type="button" disabled={pics.actionBusy} onClick={() => pics.handleShareAll(delivery.deliveryId)}>Share all</button>
                </>
              )}
            </div>
          )}
          {isSelectMode && <p className="portal-hint">Tap photos to select, then download or share them.</p>}
          {pics.actionMessage && pics.selectDeliveryId === delivery.deliveryId && <p className="portal-error">{pics.actionMessage}</p>}
          {shareLinkRow}
          <div className="customer-asset-grid">
            {delivery.assets.map((asset) => renderAsset(asset, true))}
          </div>
        </>
      )}
    </article>
  )
}
