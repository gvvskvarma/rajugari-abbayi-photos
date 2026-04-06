import { useEffect, useRef } from 'react'
import { instagramUrl } from '../lib/constants'
import { useDocumentMeta } from '../hooks/useDocumentMeta.ts'
import { createResponsiveAsset, ResponsiveImage } from '../lib/media.tsx'

const aboutPhoto = createResponsiveAsset('project-rga/about/about-vishnu.jpg')

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.classList.add('revealed')
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('revealed')
          observer.disconnect()
        }
      },
      { threshold: 0.12 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return ref
}

export function AboutPage() {
  useDocumentMeta('About', 'Meet Vishnu Varma — the story behind Rajugari Abbayi Photography. Natural light, real moments, cinematic storytelling.')
  const hookRef = useReveal<HTMLElement>()
  const storyRef = useReveal<HTMLElement>()
  const positionRef = useReveal<HTMLElement>()
  const diffRef = useReveal<HTMLElement>()
  const ctaRef = useReveal<HTMLElement>()

  return (
    <>
      {/* ── HOOK ── */}
      <section className="about-page-hero reveal-section" ref={hookRef}>
        <div className="about-page-hero-content">
          <div className="about-page-hero-text">
            <p className="eyebrow">About me</p>
            <h1>I didn't start with a camera —</h1>
            <p className="about-page-hero-body">
              I started to hold onto moments that disappear too quickly.
            </p>
          </div>
          <div className="about-page-photo-frame">
            <ResponsiveImage
              asset={aboutPhoto}
              alt="Vishnu Varma holding a camera on a gimbal"
              className="about-page-photo-img"
              sizes="(max-width: 680px) 80vw, 340px"
              loading="eager"
            />
          </div>
        </div>
      </section>

      {/* ── STORY ── */}
      <section className="about-page-block reveal-section" ref={storyRef}>
        <div className="about-page-block-inner">
          <h2>How I see</h2>
          <p>
            Over time, photography became more than a skill — it became a way of seeing.
            The way light falls. The pauses between conversations. The emotions that aren't posed.
          </p>
          <p>
            That's what I look for — not just how something looks, but how it <em>feels</em>.
          </p>
        </div>
      </section>

      {/* ── POSITIONING ── */}
      <section className="about-page-block about-page-accent reveal-section" ref={positionRef}>
        <div className="about-page-block-inner">
          <h2>Photography meets cinema</h2>
          <p>
            Today, I blend photography with cinematic storytelling — creating visuals
            that feel alive, not staged.
          </p>
          <p>
            Whether it's a quiet portrait, a celebration, or a fleeting expression,
            my goal is simple: to preserve it in a way that feels honest, timeless, and real.
          </p>
        </div>
      </section>

      {/* ── DIFFERENTIATOR ── */}
      <section className="about-page-block reveal-section" ref={diffRef}>
        <div className="about-page-block-inner">
          <h2>What sets me apart</h2>
          <div className="about-page-values">
            <div className="about-page-value">

              <h3>Real moments</h3>
              <p>I focus on what happens between poses — where the real story lives.</p>
            </div>
            <div className="about-page-value">

              <h3>Natural light</h3>
              <p>I work with light as it is — not forcing it, but shaping it.</p>
            </div>
            <div className="about-page-value">

              <h3>Genuine emotion</h3>
              <p>The best frames happen when you forget the camera is there.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="about-page-cta reveal-section" ref={ctaRef}>
        <h2>Let's tell your story.</h2>
        <p>
          If you're looking for something that feels real — I'd love to create that with you.
        </p>
        <div className="about-page-cta-actions">
          <a className="button primary" href="#/book">
            Start your story
          </a>
        </div>
        <div className="about-page-cta-contact">
          <a href="mailto:rgapics@gmail.com">rgapics@gmail.com</a>
          <span className="about-page-cta-dot" aria-hidden />
          <a href={instagramUrl} target="_blank" rel="noreferrer">
            @rajugari_abbayi_photography
          </a>
        </div>
      </section>
    </>
  )
}
