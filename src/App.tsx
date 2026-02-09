import { useEffect, useMemo, useState } from 'react'
import './App.css'
import heroPortraitImage from './assets/potraits/events/RGA03248-2.jpg'

const instagramUrl =
  'https://www.instagram.com/rajugari_abbayi_photography?igsh=azYxaHdwYmdhaTh0&utm_source=qr'
const personalInstagramUrl =
  'https://www.instagram.com/rajugari_abbayi?igsh=MTB3MHk4ODZxODM5dg%3D%3D&utm_source=qr'

const featuredShots = [
  {
    src: '/featured/landscapes/RGA02744.jpg',
    title: 'North Cascades',
    tag: 'Landscape',
  },
  {
    src: '/featured/landscapes/RGA02755.jpg',
    title: 'North Cascades',
    tag: 'Landscape',
  },
  {
    src: '/featured/landscapes/RGA02761.jpg',
    title: 'North Cascades',
    tag: 'Landscape',
  },
  {
    src: '/featured/landscapes/RGA02807.jpg',
    title: 'North Cascades',
    tag: 'Landscape',
  },
  {
    src: '/featured/landscapes/RGA03800.jpg',
    title: 'San Francisco',
    tag: 'Landscape',
  },
]

type RotatingGalleryProps = {
  title: string
  subtitle: string
  images: string[]
  cycleStep: number
}

const loadImages = (modules: Record<string, string>) =>
  Object.entries(modules)
    .sort(([pathA], [pathB]) => pathA.localeCompare(pathB))
    .map(([, path]) => path)

const RotatingGallery = ({
  title,
  subtitle,
  images,
  cycleStep,
}: RotatingGalleryProps) => {
  const [index, setIndex] = useState(0)
  const [previousIndex, setPreviousIndex] = useState<number | null>(null)
  const [isTransitioning, setIsTransitioning] = useState(false)

  useEffect(() => {
    if (images.length === 0) return
    images.forEach((src) => {
      const img = new Image()
      img.src = src
    })
  }, [images])

  useEffect(() => {
    if (images.length === 0) return
    const nextIndex = cycleStep % images.length
    setIndex((current) => {
      if (current === nextIndex) return current
      setPreviousIndex(current)
      setIsTransitioning(true)
      return nextIndex
    })
  }, [cycleStep, images.length])

  useEffect(() => {
    if (!isTransitioning) return
    const timeout = window.setTimeout(() => {
      setIsTransitioning(false)
      setPreviousIndex(null)
    }, 650)
    return () => window.clearTimeout(timeout)
  }, [isTransitioning])

  const active = images.length > 0 ? images[index % images.length] : undefined
  const previous =
    previousIndex !== null && images.length > 0
      ? images[previousIndex % images.length]
      : undefined

  return (
    <div className="rotator">
      <div className="rotator-card">
        {active ? (
          <div className="rotator-image-stack">
            {previous && isTransitioning && (
              <img
                className="rotator-image rotator-image-previous"
                src={previous}
                alt={title}
                loading="lazy"
              />
            )}
            <img
              className={`rotator-image ${
                isTransitioning ? 'rotator-image-enter' : ''
              }`}
              src={active}
              alt={title}
              loading="lazy"
            />
          </div>
        ) : (
          <div className="rotator-placeholder">
            <p>Add {title} photos</p>
            <span>src/assets/potraits</span>
          </div>
        )}
        <div className="rotator-overlay">
          <p>{title}</p>
          <span>{subtitle}</span>
        </div>
      </div>
    </div>
  )
}

function App() {
  const [cycleStep, setCycleStep] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => {
      setCycleStep((current) => current + 1)
    }, 2000)
    return () => window.clearInterval(id)
  }, [])

  const babyImages = useMemo(
    () =>
      loadImages(
        import.meta.glob(
          '/src/assets/potraits/baby/*.{jpg,JPG,jpeg,JPEG,png,PNG,webp,WEBP}',
          { eager: true, import: 'default' },
        ) as Record<string, string>,
      ),
    [],
  )
  const portraitImages = useMemo(
    () =>
      loadImages(
        import.meta.glob(
          '/src/assets/potraits/potraits/*.{jpg,JPG,jpeg,JPEG,png,PNG,webp,WEBP}',
          { eager: true, import: 'default' },
        ) as Record<string, string>,
      ),
    [],
  )
  const eventImages = useMemo(
    () =>
      loadImages(
        import.meta.glob(
          '/src/assets/potraits/events/*.{jpg,JPG,jpeg,JPEG,png,PNG,webp,WEBP}',
          { eager: true, import: 'default' },
        ) as Record<string, string>,
      ),
    [],
  )

  const heroPortrait = heroPortraitImage ?? portraitImages[0] ?? babyImages[0]
  const heroLandscape = featuredShots[0]?.src
  const sanFrancisco = featuredShots.find((shot) => shot.title === 'San Francisco')?.src
  const heroTravel = sanFrancisco ?? featuredShots[2]?.src

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <a className="brand-mark" href="#home" aria-label="Go to top">
            <img
              src="/logo/IMG_3142.PNG"
              alt="Rajugari_Abbayi Photography logo"
              loading="lazy"
            />
          </a>
          <div>
            <a
              className="brand-title"
              href={instagramUrl}
              target="_blank"
              rel="noreferrer"
            >
              Rajugari_Abbayi_Photography
            </a>
            <a
              className="brand-subtitle"
              href={personalInstagramUrl}
              target="_blank"
              rel="noreferrer"
            >
              Vishnu Varma
            </a>
          </div>
        </div>
        <nav className="nav">
          <a href="#work">Work</a>
          <a href="#about">About</a>
          <a href="#contact">Contact</a>
          <a href="/book.html">Book</a>
        </nav>
      </header>

      <main>
        <section id="home" className="hero">
          <div className="hero-text">
            <p className="eyebrow">Photography portfolio</p>
            <h1>Light, texture, and quiet moments — curated from my shoots.</h1>
            <p className="lead">
              I focus on landscapes, portraits, and the subtle details that make
              a scene feel alive. Browse the gallery and reach out to collaborate.
            </p>
            <div className="hero-actions">
              <a className="button primary" href="#work">
                View the work
              </a>
              <a className="button ghost" href="#contact">
                Let’s collaborate
              </a>
            </div>
          </div>
          <div className="hero-cards">
            <div className="hero-card tall">
              {heroPortrait && (
                <img
                  className="hero-card-image"
                  src={heroPortrait}
                  alt="Portrait"
                  loading="lazy"
                />
              )}
              <div className="hero-card-overlay">
                <p>Portraits</p>
                <span>Studio & natural light</span>
              </div>
            </div>
            <div className="hero-card wide">
              {heroLandscape && (
                <img
                  className="hero-card-image"
                  src={heroLandscape}
                  alt="Landscape"
                  loading="lazy"
                />
              )}
              <div className="hero-card-overlay">
                <p>Landscapes</p>
                <span>Golden hour stories</span>
              </div>
            </div>
            <div className="hero-card square">
              {heroTravel && (
                <img
                  className="hero-card-image"
                  src={heroTravel}
                  alt="Travel"
                  loading="lazy"
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
              A curated selection of my favorite scenes from the road. Each
              frame is a slow, cinematic moment.
            </p>
          </div>

          <div className="grid">
            {featuredShots.map((shot) => (
              <div key={shot.src} className="shot">
                <img src={shot.src} alt={shot.title} loading="lazy" />
                <div className="shot-overlay">
                  <p>{shot.title}</p>
                  <span>{shot.tag}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="work-block">
            <div className="section-head">
              <h2>Portrait stories</h2>
              <p>
                Three rotating collections for baby portraits, classic portraits,
                and event moments.
              </p>
            </div>
            <div className="rotator-grid">
              <RotatingGallery
                title="BABY SHOOTS"
                subtitle="New beginnings"
                images={babyImages}
                cycleStep={cycleStep}
              />
              <RotatingGallery
                title="Portraits"
                subtitle="People & personality"
                images={portraitImages}
                cycleStep={cycleStep}
              />
              <RotatingGallery
                title="Events"
                subtitle="Milestones & energy"
                images={eventImages}
                cycleStep={cycleStep}
              />
            </div>
          </div>
        </section>

        <section id="about" className="about">
          <div>
            <h2>About the lens</h2>
            <p>
              I’m Vishnu Varma, a photographer focused on candid stories,
              textured light, and the quiet energy of people in their spaces. My
              work blends editorial composition with documentary honesty.
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
            <h2>Let’s build something beautiful</h2>
            <p>
              Want to book a shoot, collaborate, or hire me? Send a note and I’ll
              reply within two business days.
            </p>
          </div>
          <div className="contact-card">
            <p className="muted">Email</p>
            <p className="contact-line">rgapics@gmail.com</p>
            <p className="muted">Instagram</p>
            <a
              className="contact-line"
              href={instagramUrl}
              target="_blank"
              rel="noreferrer"
            >
              @rajugari_abbayi_photography
            </a>
          </div>
        </section>
      </main>

      <footer className="footer">
        <p>© 2026 Rajugari_Abbayi Photography. Crafted with intention.</p>
      </footer>
    </div>
  )
}

export default App
