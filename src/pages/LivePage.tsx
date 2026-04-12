import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { youtubeChannelUrl, youtubeLiveUrl } from '../lib/constants'
import { useDocumentMeta } from '../hooks/useDocumentMeta.ts'
import { useReveal } from '../hooks/useReveal'
import { useLiveConfig } from '../hooks/queries/useLiveConfig'
import { useAuthContext } from '../context/AuthContext'
import { workerRequest } from '../hooks/useApi'
import { queryKeys } from '../lib/queryKeys'

export function LivePage() {
  useDocumentMeta(
    'Live',
    'Watch live photography sessions by Rajugari Abbayi Photography. Tune in for behind-the-scenes shoots, editing walkthroughs, and real-time coverage.',
  )

  const { session, role, getAccessToken } = useAuthContext()
  const isAdmin = Boolean(session && role === 'admin')
  const { data: liveData } = useLiveConfig()
  const config = liveData?.config
  const queryClient = useQueryClient()

  const [showPlayer, setShowPlayer] = useState(false)

  /* Admin edit state */
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')

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

  /* Dynamic content from config */
  const hasEvent = Boolean(config?.title)
  const displayTitle = config?.title || 'Rajugari Abbayi Photography'
  const displayDescription =
    config?.description ||
    'Catch behind-the-scenes shoots, live event coverage, and editing sessions as they happen.'

  const heroRef = useReveal<HTMLElement>()
  const playerRef = useReveal<HTMLElement>()
  const channelRef = useReveal<HTMLElement>()

  return (
    <>
      {/* ── ADMIN CONTROLS ── */}
      {isAdmin && (
        <div className="live-page-admin-panel">
          <div className="live-page-admin-header">
            <p className="eyebrow">Admin</p>
            <h3>Live Stream Settings</h3>
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
      )}

      {/* ── HERO ── */}
      <section className="live-page-hero reveal-section" ref={heroRef}>
        <p className="eyebrow">Watch Live</p>
        <h1 className={hasEvent ? 'live-page-event-title' : ''}>{displayTitle}</h1>
        {hasEvent && config?.description ? (
          <div className="live-page-event-details">
            {config.description.split('\n').map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        ) : (
          <p className="live-page-subtitle">{displayDescription}</p>
        )}
        <div className="live-page-hero-actions">
          <a
            className="button primary"
            href={youtubeLiveUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open YouTube Live
          </a>
          <button
            className="button ghost"
            type="button"
            onClick={() => setShowPlayer(true)}
          >
            Watch Live Here
          </button>
        </div>
      </section>

      {/* ── PLAYER ── */}
      <section className="live-page-player reveal-section" ref={playerRef}>
        {showPlayer ? (
          <div className="live-page-embed-wrapper">
            <span className="live-page-badge">YouTube Live</span>
            <iframe
              src={`https://www.youtube.com/embed/live_stream?channel=UCRc_IOjhoBtuCmjEe14Ru4Q&autoplay=1&playsinline=1&rel=0&modestbranding=1&origin=${encodeURIComponent(window.location.origin)}`}
              title={`${displayTitle} — Live Stream`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
            <p className="live-page-embed-hint">
              If no live stream is active, the player will show a YouTube
              placeholder.
            </p>
          </div>
        ) : (
          <button
            type="button"
            className="live-page-placeholder"
            onClick={() => setShowPlayer(true)}
            aria-label="Start watching live"
          >
            <span className="live-page-placeholder-icon" aria-hidden="true">
              &#9654;
            </span>
            <span>Watch Live Here</span>
          </button>
        )}
      </section>

      {/* ── CHANNEL LINK ── */}
      <section className="live-page-channel reveal-section" ref={channelRef}>
        <h2>Visit Rajugari Abbayi YouTube Channel</h2>
        <p>
          Browse past sessions, cinematic reels, and photography highlights on
          YouTube.
        </p>
        <a
          className="button primary"
          href={youtubeChannelUrl}
          target="_blank"
          rel="noreferrer"
        >
          Go to YouTube Channel
        </a>
      </section>
    </>
  )
}
