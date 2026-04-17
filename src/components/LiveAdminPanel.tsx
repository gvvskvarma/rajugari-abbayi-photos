import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { LiveConfig } from '../hooks/queries/useLiveConfig'
import { useAuthContext } from '../context/AuthContext'
import { workerRequest } from '../hooks/useApi'
import { queryKeys } from '../lib/queryKeys'

interface LiveAdminPanelProps {
  config: LiveConfig | null | undefined
  isLive: boolean
}

export function LiveAdminPanel({ config, isLive }: LiveAdminPanelProps) {
  const { getAccessToken } = useAuthContext()
  const queryClient = useQueryClient()

  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [toggling, setToggling] = useState(false)

  const startEditing = () => {
    setEditTitle(config?.title ?? '')
    setEditDescription(config?.description ?? '')
    setEditing(true)
    setSaveMessage('')
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveMessage('')
    try {
      const token = await getAccessToken()
      if (!token) {
        setSaveMessage('Session expired. Please log out and log in again.')
        setSaving(false)
        return
      }
      await workerRequest('/api/v1/live-config', token, {
        method: 'PATCH',
        body: { title: editTitle, description: editDescription },
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.liveConfig() })
      setSaveMessage('Saved')
      setEditing(false)
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleLive = async () => {
    setToggling(true)
    try {
      const token = await getAccessToken()
      if (!token) return
      await workerRequest('/api/v1/live-config', token, {
        method: 'PATCH',
        body: { isLive: !isLive },
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.liveConfig() })
    } catch {
      // silent — toggle will revert via query refetch
    } finally {
      setToggling(false)
    }
  }

  return (
    <div className="live-page-admin-panel">
      <div className="live-page-admin-header">
        <p className="eyebrow">Admin</p>
        <h3>Live Stream Settings</h3>
      </div>

      {/* Live toggle */}
      <div className="live-page-admin-toggle-row">
        <span className="live-page-admin-toggle-label">
          {isLive ? 'Stream is LIVE' : 'Stream is OFF'}
        </span>
        <button
          type="button"
          className={`live-page-toggle ${isLive ? 'is-on' : ''}`}
          onClick={() => void handleToggleLive()}
          disabled={toggling}
          aria-label={isLive ? 'Turn off live stream' : 'Turn on live stream'}
        >
          <span className="live-page-toggle-knob" />
        </button>
      </div>

      {editing ? (
        <div className="live-page-admin-form">
          <label>
            Event Title
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="e.g. Akhil & Bindu Wedding"
              maxLength={255}
            />
          </label>
          <label>
            Event Description
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="e.g. Live coverage of the wedding ceremony and reception"
              rows={3}
              maxLength={5000}
            />
          </label>
          <div className="live-page-admin-actions">
            <button className="button primary" type="button" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button className="button ghost" type="button" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="live-page-admin-preview">
          <p>
            <strong>Title:</strong> {config?.title || <span className="muted">Not set</span>}
          </p>
          <p>
            <strong>Description:</strong> {config?.description || <span className="muted">Not set</span>}
          </p>
          <button className="button ghost" type="button" onClick={startEditing}>
            Edit
          </button>
        </div>
      )}
      {saveMessage && <p className="live-page-admin-message">{saveMessage}</p>}
    </div>
  )
}
