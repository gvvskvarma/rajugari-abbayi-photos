import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import './book.css'

const instagramUrl =
  'https://www.instagram.com/rajugari_abbayi_photography?igsh=azYxaHdwYmdhaTh0&utm_source=qr'
const personalInstagramUrl =
  'https://www.instagram.com/rajugari_abbayi?igsh=MTB3MHk4ODZxODM5dg%3D%3D&utm_source=qr'

const shootTypes = [
  'Baby shoot',
  'Baby shower',
  'Birthday',
  'Candid',
  'Collab',
  'Engagement',
  'Other',
  'Portrait',
  'Pre wedding',
  'Reel',
]

const formAction = import.meta.env.VITE_FORMSPREE_ENDPOINT ?? ''
const isConfigured = Boolean(formAction)

const BookPage = () => {
  const showSuccess =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('success') === '1'

  useEffect(() => {
    if (!showSuccess) return
    const timeout = window.setTimeout(() => {
      window.location.href = '/#home'
    }, 5000)
    return () => window.clearTimeout(timeout)
  }, [showSuccess])

  return (
    <div className="page">
    <header className="topbar">
      <div className="brand">
        <a className="brand-mark" href="/#home" aria-label="Go to home">
          <img src="/logo/IMG_3142.PNG" alt="Rajugari_Abbayi Photography logo" />
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
        <a href="/#work">Work</a>
        <a href="/#about">About</a>
        <a href="/#contact">Contact</a>
      </nav>
    </header>

    <main className="book-main">
      <section className="book-hero">
        <div>
          <p className="eyebrow">Booking</p>
          <h1>Tell me about the shoot you’re planning.</h1>
          <p className="lead">
            Share the essentials and I’ll follow up with availability, pricing,
            and next steps. Required fields are marked.
          </p>
        </div>
        <div className="book-card">
          <p className="book-card-title">What happens next</p>
          <ul>
            <li>I review your enquiry and confirm the shoot type.</li>
            <li>You’ll get a response within two business days.</li>
            <li>We lock the date and finalize the details.</li>
          </ul>
        </div>
      </section>

      <section className="book-form-section">
        {showSuccess && (
          <div className="form-success">
            Thank you for reaching out! I received your enquiry and will get
            back to you as soon as possible.
          </div>
        )}
        {!isConfigured && (
          <div className="form-alert">
            Set `VITE_FORMSPREE_ENDPOINT` in your `.env` file to start receiving
            emails in Gmail.
          </div>
        )}
        <form
          className="enquiry-form"
          method="POST"
          action={formAction || 'https://formspree.io/f/yourFormId'}
        >
          <input type="hidden" name="_subject" value="New photography enquiry" />
          <input
            type="hidden"
            name="_next"
            value={`${window.location.origin}/book.html?success=1`}
          />
          <div className="form-grid">
            <label>
              Full name *
              <input type="text" name="name" required placeholder="Your name" />
            </label>
            <label>
              Email *
              <input
                type="email"
                name="email"
                required
                placeholder="you@email.com"
              />
            </label>
            <label>
              Phone *
              <input
                type="tel"
                name="phone"
                required
                placeholder="(555) 123-4567"
              />
            </label>
            <label>
              Shoot type *
              <select name="shootType" required defaultValue="">
                <option value="" disabled>
                  Select a shoot type
                </option>
                {shootTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Shoot date
              <input type="date" name="shootDate" />
            </label>
            <label>
              Location
              <input type="text" name="location" placeholder="City / Venue" />
            </label>
          </div>
          <label className="form-message">
            Tell me more
            <textarea
              name="message"
              rows={5}
              placeholder="Share your vision, timeline, and any must-have shots."
            />
          </label>
          <button className="button primary" type="submit" disabled={!isConfigured}>
            Send enquiry
          </button>
        </form>
      </section>
    </main>

    <footer className="footer">
      <p>© 2026 Rajugari_Abbayi Photography. Crafted with intention.</p>
    </footer>
  </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BookPage />
  </StrictMode>,
)
