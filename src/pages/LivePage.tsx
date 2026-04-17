import { useState } from 'react'
import { youtubeChannelUrl, youtubeLiveUrl } from '../lib/constants'
import { useDocumentMeta } from '../hooks/useDocumentMeta.ts'
import { useReveal } from '../hooks/useReveal'
import { useLiveConfig } from '../hooks/queries/useLiveConfig'
import { useAuthContext } from '../context/AuthContext'
import { LiveAdminPanel } from '../components/LiveAdminPanel'

export function LivePage() {
  useDocumentMeta(
    'Live',
    'Watch live photography sessions by Rajugari Abbayi Photography. Tune in for behind-the-scenes shoots, editing walkthroughs, and real-time coverage.',
  )

  const { session, role } = useAuthContext()
  const isAdmin = Boolean(session && role === 'admin')
  const { data: liveData } = useLiveConfig()
  const config = liveData?.config
  const isLive = config?.isLive ?? false

  const [showPlayer, setShowPlayer] = useState(false)

  /* Dynamic content from config */
  const hasEvent = Boolean(config?.title)
  const displayTitle = config?.title || 'Rajugari Abbayi Photography'
  const displayDescription =
    config?.description ||
    'Catch behind-the-scenes shoots, live event coverage, and editing sessions as they happen.'

  const heroRef = useReveal<HTMLElement>()
  const playerRef = useReveal<HTMLElement>()
  const channelRef = useReveal<HTMLElement>()

  /* Non-admin visitors see "no live" message when stream is off */
  if (!isLive && !isAdmin) {
    return (
      <section className="live-page-channel reveal-section" ref={channelRef} style={{ marginTop: 0 }}>
        <p className="eyebrow">Live</p>
        <h2>No live stream right now</h2>
        <p>
          Check back later or visit our YouTube channel for past sessions,
          cinematic reels, and photography highlights.
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
    )
  }

  return (
    <>
      {/* ── ADMIN CONTROLS ── */}
      {isAdmin && <LiveAdminPanel config={config} isLive={isLive} />}

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
