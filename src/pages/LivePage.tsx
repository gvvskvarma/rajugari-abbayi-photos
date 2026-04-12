import { useState } from 'react'
import { youtubeChannelUrl, youtubeLiveUrl } from '../lib/constants'
import { useDocumentMeta } from '../hooks/useDocumentMeta.ts'
import { useReveal } from '../hooks/useReveal'

export function LivePage() {
  useDocumentMeta(
    'Live',
    'Watch live photography sessions by Rajugari Abbayi Photography. Tune in for behind-the-scenes shoots, editing walkthroughs, and real-time coverage.',
  )

  const [showPlayer, setShowPlayer] = useState(false)

  const heroRef = useReveal<HTMLElement>()
  const playerRef = useReveal<HTMLElement>()
  const channelRef = useReveal<HTMLElement>()

  return (
    <>
      {/* ── HERO ── */}
      <section className="live-page-hero reveal-section" ref={heroRef}>
        <p className="eyebrow">Watch Live</p>
        <h1>Rajugari Abbayi Photography</h1>
        <p className="live-page-subtitle">
          Catch behind-the-scenes shoots, live event coverage, and editing
          sessions as they happen.
        </p>
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
              src="https://www.youtube.com/embed/live_stream?channel=UCYourChannelID"
              title="Rajugari Abbayi Photography — Live Stream"
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
