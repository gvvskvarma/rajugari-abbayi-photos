import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { createResponsiveAsset, ResponsiveImage } from '../lib/media.tsx'
import { instagramUrl, contactEmail } from '../lib/constants'
import { fallbackLandscapes, fallbackBaby, fallbackPortraits, fallbackEvents } from '../lib/galleryFallbacks'
import { RotatingGallery } from '../components/RotatingGallery.tsx'
import { useHomepageGallery } from '../hooks/queries/useHomepageGallery.ts'
import { useReveal } from '../hooks/useReveal'
import { useDocumentMeta } from '../hooks/useDocumentMeta.ts'

/* ── Service cards data ───────────────────────────────────────────── */
const services = [
  { label: 'Portraits', desc: 'Studio & outdoor sessions' },
  { label: 'Events', desc: 'Birthdays, baby showers & more' },
  { label: 'Pre-Wedding', desc: 'Engagements & couple shoots' },
  { label: 'Videos & Reels', desc: 'Cinematic short-form content' },
  { label: 'Brand Collabs', desc: 'Product & influencer shoots' },
  { label: 'Baby Shoots', desc: 'Newborn & milestone moments' },
]

/* ── Stats strip ──────────────────────────────────────────────────── */
const stats = [
  { value: '10,000+', label: 'Moments captured' },
  { value: '50+', label: 'Stories told' },
  { value: '5+', label: 'Years shooting' },
]

/* ── Component ────────────────────────────────────────────────────── */
export function HomePage({ sectionId }: { sectionId?: string }) {
  useDocumentMeta('', 'Bold portraits, cinematic events, and candid magic by Vishnu Varma. Book your shoot today.')
  const [cycleStep, setCycleStep] = useState(0)
  const { data: galleryData } = useHomepageGallery()

  /* Build responsive assets from dynamic keys (or fallbacks) */
  const { landscapeAssets, babyAssets, portraitAssets, eventAssets } = useMemo(() => {
    const cats = galleryData?.categories
    const lKeys = cats?.landscapes?.length ? cats.landscapes : fallbackLandscapes
    const bKeys = cats?.baby?.length ? cats.baby : fallbackBaby
    const pKeys = cats?.portraits?.length ? cats.portraits : fallbackPortraits
    const eKeys = cats?.events?.length ? cats.events : fallbackEvents
    return {
      landscapeAssets: lKeys.map(createResponsiveAsset),
      babyAssets: bKeys.map(createResponsiveAsset),
      portraitAssets: pKeys.map(createResponsiveAsset),
      eventAssets: eKeys.map(createResponsiveAsset),
    }
  }, [galleryData])

  /* Hero picks */
  const heroImage = useMemo(
    () => eventAssets[0] ?? landscapeAssets[0],
    [eventAssets, landscapeAssets]
  )

  /* Rotating gallery cycle */
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = window.setInterval(() => setCycleStep((s) => s + 1), 2000)
    return () => window.clearInterval(id)
  }, [])

  /* Scroll to section */
  useEffect(() => {
    if (!sectionId) return
    const el = document.getElementById(sectionId)
    if (el) el.scrollIntoView({ behavior: 'smooth' })
  }, [sectionId])

  /* Section refs for scroll reveal */
  const heroRef = useReveal<HTMLElement>()
  const servicesRef = useReveal<HTMLElement>()
  const workRef = useReveal<HTMLElement>()
  const contactRef = useReveal<HTMLElement>()

  return (
    <>
      {/* ── HERO ── */}
      <section id="home" className="hero-v2 reveal-section" ref={heroRef}>
        <div className="hero-v2-bg">
          {heroImage && (
            <ResponsiveImage
              asset={heroImage}
              alt=""
              className="hero-v2-bg-img"
              sizes="100vw"
              loading="eager"
              fetchPriority="high"
            />
          )}
          <div className="hero-v2-overlay" />
        </div>
        <div className="hero-v2-content">
          <p className="eyebrow">Rajugari Abbayi Photography</p>
          <h1>Your moments.</h1>
          <p className="hero-v2-tagline">Made&nbsp;iconic.</p>
          <p className="lead">
            Bold portraits, cinematic events, candid magic — I turn everyday
            moments into visuals you'll keep coming back to.
          </p>
          <div className="hero-actions">
            <Link className="button primary" to="/book">
              Start your story
            </Link>
            <Link className="button ghost" to="/work">
              View my work
            </Link>
          </div>
        </div>

        {/* Stats strip */}
        <div className="hero-stats">
          {stats.map((s) => (
            <div key={s.label} className="hero-stat">
              <span className="hero-stat-value">{s.value}</span>
              <span className="hero-stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── MARQUEE RIBBON ── */}
      <div className="marquee-band" aria-hidden="true">
        <div className="marquee-track">
          {[0, 1].map((group) => (
            <div className="marquee-group" key={group}>
              {[...services, ...services].map((svc, index) => (
                <span className="marquee-item" key={index}>
                  {svc.label}
                  <span className="marquee-star">✦</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── SERVICES ── */}
      <section className="services-section reveal-section" ref={servicesRef}>
        <div className="section-head">
          <h2>What I shoot</h2>
          <p>
            From intimate portraits to high-energy events — I bring the same
            energy and eye for detail to every project.
          </p>
        </div>
        <div className="services-grid">
          {services.map((svc) => (
            <div key={svc.label} className="service-card">
              <h3>{svc.label}</h3>
              <p>{svc.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── WORK ── */}
      <section id="work" className="work reveal-section" ref={workRef}>
        <div className="section-head">
          <h2>Stories I've told</h2>
          <p>Portraits, celebrations, and the quiet moments in between.</p>
        </div>
        <div className="rotator-grid">
          <RotatingGallery title="Portraits" subtitle="Real people, real vibes" images={portraitAssets} cycleStep={cycleStep} href="/work?tab=portraits" />
          <RotatingGallery title="Baby shoots" subtitle="Tiny humans, big smiles" images={babyAssets} cycleStep={cycleStep} href="/work?tab=baby" />
          <RotatingGallery title="Events" subtitle="The energy, captured" images={eventAssets} cycleStep={cycleStep} href="/work?tab=events" />
          <RotatingGallery title="Landscapes" subtitle="Wide skies, golden light" images={landscapeAssets} cycleStep={cycleStep} href="/work?tab=landscapes" />
        </div>
      </section>

      {/* ── CONTACT ── */}
      <section id="contact" className="contact reveal-section" ref={contactRef}>
        <div>
          <h2>Let's tell your story.</h2>
          <p>
            Got an event coming up? Want fresh content for your brand? Or just
            need some fire portraits? I'd love to hear about it.
          </p>
          <div className="contact-actions">
            <Link className="button primary" to="/book">
              Start your story
            </Link>
          </div>
        </div>
        <div className="contact-card">
          <div className="contact-item">
            <p className="muted">Email</p>
            <p className="contact-line">{contactEmail}</p>
          </div>
          <div className="contact-item">
            <p className="muted">Instagram</p>
            <a className="contact-line" href={instagramUrl} target="_blank" rel="noreferrer">
              @rajugari_abbayi_photography
            </a>
          </div>
        </div>
      </section>
    </>
  )
}
