import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import '../book.css'
import { instagramUrl } from '../lib/constants'

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

export function BookPage() {
  const navigate = useNavigate()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submissionState, setSubmissionState] = useState<'idle' | 'success' | 'error'>('idle')

  useEffect(() => {
    if (submissionState !== 'success') return
    const timeout = window.setTimeout(() => {
      void navigate('/')
    }, 5000)
    return () => window.clearTimeout(timeout)
  }, [submissionState, navigate])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isConfigured || isSubmitting) return

    setIsSubmitting(true)
    setSubmissionState('idle')

    const form = event.currentTarget
    const formData = new FormData(form)
    formData.set('_subject', 'New photography enquiry')

    try {
      const response = await fetch(formAction, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: formData,
      })

      if (!response.ok) {
        throw new Error(`Formspree request failed with ${response.status}`)
      }

      form.reset()
      setSubmissionState('success')
    } catch (error) {
      console.error('Form submission failed', error)
      setSubmissionState('error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <section className="book-hero">
        <div>
          <p className="eyebrow">Booking</p>
          <h1>Tell me about the shoot you're planning.</h1>
          <p className="lead">
            Share the essentials and I'll follow up with availability, pricing,
            and next steps. Required fields are marked.
          </p>
          <div className="book-direct-contact">
            <p className="book-direct-label">Email</p>
            <a className="book-direct-link" href="mailto:rgapics@gmail.com">
              rgapics@gmail.com
            </a>
            <p className="book-direct-label">Instagram</p>
            <a className="book-direct-link" href={instagramUrl} target="_blank" rel="noreferrer">
              @rajugari_abbayi_photography
            </a>
          </div>
        </div>
        <div className="book-card">
          <p className="book-card-title">What happens next</p>
          <ul>
            <li>I personally review your enquiry and confirm the shoot details.</li>
            <li>You'll receive clear pricing and package options upfront.</li>
            <li>You'll get a response within 24–48 hours.</li>
            <li>We lock the date and finalize everything together.</li>
          </ul>
        </div>
      </section>

      <section className="book-form-section">
        {submissionState === 'success' && (
          <div className="form-success">
            Thank you for reaching out! I received your enquiry and will get
            back to you as soon as possible.
          </div>
        )}
        {submissionState === 'error' && (
          <div className="form-alert">
            Something went wrong while sending your enquiry. Please try again.
          </div>
        )}
        {!isConfigured && (
          <div className="form-alert">
            Set `VITE_FORMSPREE_ENDPOINT` in your `.env` file to start receiving
            emails in Gmail.
          </div>
        )}
        <form className="enquiry-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <label>
              Full name *
              <input type="text" name="name" required placeholder="Your name" />
            </label>
            <label>
              Email *
              <input type="email" name="email" required placeholder="you@email.com" />
            </label>
            <label>
              Phone *
              <input type="tel" name="phone" required placeholder="(555) 123-4567" />
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
              placeholder="Tell me about your vision, mood, and any must-have moments."
            />
          </label>
          <button className="button primary book-cta" type="submit" disabled={!isConfigured || isSubmitting}>
            {isSubmitting ? 'Sending...' : "Let's plan your shoot"}
          </button>
          <p className="book-trust-note">No spam. No pressure. I typically respond within 24–48 hours.</p>
        </form>
      </section>
    </>
  )
}
