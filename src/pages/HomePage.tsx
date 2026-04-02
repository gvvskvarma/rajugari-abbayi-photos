import { useEffect, useState } from 'react'
import type { GalleryShot } from '../types'
import { createResponsiveAsset, ResponsiveImage } from '../lib/media.tsx'
import { instagramUrl } from '../lib/constants'
import { RotatingGallery } from '../components/RotatingGallery.tsx'

const landscapePaths = [
  'project-rga/landscapes/RGA02744.jpg',
  'project-rga/landscapes/RGA02755.jpg',
  'project-rga/landscapes/RGA02761.jpg',
  'project-rga/landscapes/RGA02807.jpg',
  'project-rga/landscapes/RGA03800.jpg',
]

const featuredShots: GalleryShot[] = [
  { image: createResponsiveAsset(landscapePaths[0]), title: 'North Cascades', tag: 'Landscape' },
  { image: createResponsiveAsset(landscapePaths[1]), title: 'North Cascades', tag: 'Landscape' },
  { image: createResponsiveAsset(landscapePaths[2]), title: 'North Cascades', tag: 'Landscape' },
  { image: createResponsiveAsset(landscapePaths[3]), title: 'North Cascades', tag: 'Landscape' },
  { image: createResponsiveAsset(landscapePaths[4]), title: 'San Francisco', tag: 'Landscape' },
]

const babyImages = [
  'project-rga/potraits/baby/RGA03628.jpg',
  'project-rga/potraits/baby/RGA03631.jpg',
  'project-rga/potraits/baby/RGA03639.jpg',
  'project-rga/potraits/baby/RGA03656.jpg',
  'project-rga/potraits/baby/RGA03664.jpg',
  'project-rga/potraits/baby/RGA03667.jpg',
].map(createResponsiveAsset)

const portraitImages = [
  'project-rga/potraits/potraits/RGA04154.jpg',
  'project-rga/potraits/potraits/RGA04156.jpg',
  'project-rga/potraits/potraits/RGA04170-2.jpg',
  'project-rga/potraits/potraits/RGA04174-2.jpg',
  'project-rga/potraits/potraits/RGA04188-2.jpg',
  'project-rga/potraits/potraits/RGA04203-2.jpg',
  'project-rga/potraits/potraits/RGA04280.jpg',
  'project-rga/potraits/potraits/RGA04306-4.jpg',
].map(createResponsiveAsset)

const eventImages = [
  'project-rga/potraits/events/RGA03248-2.jpg',
  'project-rga/potraits/events/RGA03250.jpg',
  'project-rga/potraits/events/RGA03281.jpg',
  'project-rga/potraits/events/RGA03341.jpg',
  'project-rga/potraits/events/RGA03884.jpg',
  'project-rga/potraits/events/RGA03886.jpg',
  'project-rga/potraits/events/RGA03898.jpg',
  'project-rga/potraits/events/RGA03987.jpg',
  'project-rga/potraits/events/RGA03994.jpg',
  'project-rga/potraits/events/RGA04058.jpg',
  'project-rga/potraits/events/RGA04064.jpg',
  'project-rga/potraits/events/RGA04135.jpg',
  'project-rga/potraits/events/RGA04158.jpg',
  'project-rga/potraits/events/RGA04191.jpg',
  'project-rga/potraits/events/RGA04205.jpg',
].map(createResponsiveAsset)

const heroPortrait = createResponsiveAsset('project-rga/potraits/events/RGA03248-2.jpg')
const heroLandscape = featuredShots[0]?.image
const heroTravel = featuredShots[4]?.image ?? featuredShots[2]?.image

export function HomePage({ sectionId }: { sectionId?: string }) {
  const [cycleStep, setCycleStep] = useState(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = window.setInterval(() => {
      setCycleStep((current) => current + 1)
    }, 2000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!sectionId) return
    const el = document.getElementById(sectionId)
    if (el) el.scrollIntoView({ behavior: 'smooth' })
  }, [sectionId])

  return (
    <>
      <section id="home" className="hero">
        <div className="hero-text">
          <p className="eyebrow">Photography portfolio</p>
          <h1>Light, texture, and quiet moments — curated from my shoots.</h1>
          <p className="lead">
            I focus on landscapes, portraits, and the subtle details that make
            a scene feel alive. Browse the gallery and reach out to collaborate.
          </p>
          <div className="hero-actions">
            <a className="button primary" href="#/work">
              View the work
            </a>
            <a className="button ghost" href="#/book">
              Let's collaborate
            </a>
          </div>
        </div>
        <div className="hero-cards">
          <div className="hero-card tall">
            <ResponsiveImage
              asset={heroPortrait}
              alt="Portrait"
              className="hero-card-image"
              sizes="(max-width: 900px) 92vw, 32vw"
              loading="eager"
              fetchPriority="high"
            />
            <div className="hero-card-overlay">
              <p>Portraits</p>
              <span>Studio & natural light</span>
            </div>
          </div>
          <div className="hero-card wide">
            {heroLandscape && (
              <ResponsiveImage
                asset={heroLandscape}
                alt="Landscape"
                className="hero-card-image"
                sizes="(max-width: 900px) 92vw, 66vw"
                loading="eager"
                fetchPriority="high"
              />
            )}
            <div className="hero-card-overlay">
              <p>Landscapes</p>
              <span>Golden hour stories</span>
            </div>
          </div>
          <div className="hero-card square">
            {heroTravel && (
              <ResponsiveImage
                asset={heroTravel}
                alt="Travel"
                className="hero-card-image"
                sizes="(max-width: 900px) 92vw, 32vw"
                loading="eager"
              />
            )}
            <div className="hero-card-overlay">
              <p>Travel</p>
              <span>Everyday poetry</span>
            </div>
          </div>
        </div>
      </section>

      <section id="work" className="work">
        <div className="section-head">
          <h2>Landscapes</h2>
          <p>
            A quiet gallery of scenes from the road. Each frame is chosen to feel
            collected rather than merely shown.
          </p>
        </div>

        <div className="landscape-showcase">
          {featuredShots[0] && (
            <article className="landscape-showcase-main">
              <ResponsiveImage
                asset={featuredShots[0].image}
                alt={featuredShots[0].title}
                sizes="(max-width: 900px) 92vw, 92vw"
                loading="eager"
                fetchPriority="high"
              />
              <div className="landscape-showcase-overlay">
                <p>{featuredShots[0].title}</p>
                <span>{featuredShots[0].tag}</span>
              </div>
            </article>
          )}

          <div className="landscape-showcase-strip" aria-label="Additional landscape highlights">
            {featuredShots.slice(1).map((shot) => (
              <article key={shot.image.key} className="landscape-showcase-card">
                <ResponsiveImage
                  asset={shot.image}
                  alt={shot.title}
                  sizes="(max-width: 900px) 44vw, 22vw"
                />
                <div className="landscape-showcase-overlay">
                  <p>{shot.title}</p>
                  <span>{shot.tag}</span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="work-block">
          <div className="section-head">
            <h2>Portrait stories</h2>
          </div>
          <div className="rotator-grid">
            <RotatingGallery title="BABY SHOOTS" subtitle="New beginnings" images={babyImages} cycleStep={cycleStep} />
            <RotatingGallery title="Portraits" subtitle="People & personality" images={portraitImages} cycleStep={cycleStep} />
            <RotatingGallery title="Events" subtitle="Milestones & energy" images={eventImages} cycleStep={cycleStep} />
          </div>
        </div>
      </section>

      <section id="about" className="about">
        <div>
          <h2>About the lens</h2>
          <p>
            I'm Vishnu Varma, a photographer focused on candid stories, textured light,
            and the quiet energy of people in their spaces. My work blends editorial
            composition with documentary honesty.
          </p>
        </div>
        <div className="about-card">
          <h3>Available for</h3>
          <ul>
            <li>Portrait sessions</li>
            <li>Brand campaigns</li>
            <li>Editorial shoots</li>
            <li>Travel collaborations</li>
          </ul>
        </div>
      </section>

      <section id="contact" className="contact">
        <div>
          <h2>Let's build something beautiful</h2>
          <p>
            Want to book a shoot, collaborate, or hire me? Send a note and I'll reply
            within two business days.
          </p>
          <div className="contact-actions">
            <a className="button primary" href="#/book">
              Open contact form
            </a>
          </div>
        </div>
        <div className="contact-card">
          <div className="contact-item">
            <p className="muted">Email</p>
            <p className="contact-line">rgapics@gmail.com</p>
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
