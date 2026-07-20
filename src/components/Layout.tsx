import { useEffect, useRef } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import '../App.css'
import { isSupabaseConfigured } from '../lib/supabase'
import { useAuthContext } from '../context/AuthContext'
import { useAuth } from '../hooks/useAuth'
import { useLiveConfig } from '../hooks/queries/useLiveConfig'
import { personalInstagramUrl, instagramUrl, contactEmail } from '../lib/constants'
import { queryClient } from '../lib/queryClient'
import { AuthProvider } from '../context/AuthContext'

function LayoutInner() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const authBoxRef = useRef<HTMLDivElement>(null)
  const { session, role, loginLabel } = useAuthContext()
  const { data: liveData } = useLiveConfig()
  const isLive = liveData?.config?.isLive ?? false
  const isAdmin = Boolean(session && role === 'admin')
  const {
    authMenuOpen,
    setAuthMenuOpen,
    emailInput,
    setEmailInput,
    authCode,
    setAuthCode,
    authCodeReady,
    authMessage,
    authBusy,
    handleSendOtp,
    handleVerifyOtp,
    handleSignOut,
  } = useAuth({ onSignOut: () => navigate('/') })

  /* SPA navigation keeps scroll position — land each new page at the top. */
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
    setAuthMenuOpen(false)
  }, [pathname, setAuthMenuOpen])

  /* Close the login menu on outside click or Escape. */
  useEffect(() => {
    if (!authMenuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!authBoxRef.current?.contains(event.target as Node)) setAuthMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAuthMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [authMenuOpen, setAuthMenuOpen])

  return (
    <div className="page">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <header className="topbar">
        <div className="brand">
          <Link className="brand-mark" to="/" aria-label="Go to top">
            <img
              src="/logo/logo-200.png"
              alt="Rajugari_Abbayi Photography logo"
              loading="eager"
            />
          </Link>
          <div>
            <Link className="brand-title" to="/">
              Rajugari_Abbayi_Photography
            </Link>
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

        <div className="topbar-right">
          <nav className="nav">
            {session && role === 'customer' && <NavLink to="/my-pictures">My Pictures</NavLink>}
            {session && role === 'admin' && <NavLink to="/upload">Upload</NavLink>}
            {session && role === 'admin' && <NavLink to="/admin/clients">Clients</NavLink>}
            {!(session && role === 'admin') && <NavLink to="/work">Work</NavLink>}
            {!(session && role === 'admin') && <NavLink to="/about">About</NavLink>}
            {(isLive || isAdmin) && <NavLink to="/live">{isLive ? 'Live' : 'Live (off)'}</NavLink>}
            {!(session && role === 'admin') && <NavLink to="/book">Contact</NavLink>}
          </nav>

          <div className="auth-box" ref={authBoxRef}>
            <button
              className="login-icon"
              type="button"
              aria-label="Open login menu"
              onClick={() => setAuthMenuOpen((open) => !open)}
            >
              <span aria-hidden>📷</span>
              <span className="login-label">{loginLabel}</span>
            </button>

            {authMenuOpen && (
              <div className="auth-menu">
                {!isSupabaseConfigured && (
                  <p className="auth-note">
                    Configure Supabase env vars to enable login.
                  </p>
                )}

                {session ? (
                  <>
                    <p className="auth-note">
                      Logged in as <strong>{session.user.email}</strong>
                      {role === 'admin' && ' (Admin)'}
                    </p>
                    <button className="button ghost" type="button" onClick={() => void handleSignOut()}>
                      Logout
                    </button>
                  </>
                ) : (
                  <>
                    <p className="auth-note">
                      Code login needs the Supabase email template to send a one-time code.
                    </p>

                    <form className="auth-form" onSubmit={handleSendOtp}>
                      <label>
                        Email
                        <input
                          type="email"
                          value={emailInput}
                          onChange={(event) => setEmailInput(event.target.value)}
                          placeholder="name@email.com"
                          required
                        />
                      </label>
                      <button className="button primary" type="submit" disabled={authBusy}>
                        {authBusy ? 'Sending...' : authCodeReady ? 'Resend Code' : 'Send Code'}
                      </button>
                    </form>

                    {authCodeReady && (
                      <form className="auth-form auth-code-form" onSubmit={handleVerifyOtp}>
                        <label>
                          Code
                          <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            value={authCode}
                            onChange={(event) => setAuthCode(event.target.value)}
                            placeholder="123456"
                            required
                          />
                        </label>
                        <button className="button primary" type="submit" disabled={authBusy}>
                          {authBusy ? 'Verifying...' : 'Verify Code'}
                        </button>
                      </form>
                    )}
                  </>
                )}

                {authMessage && <p className="auth-note">{authMessage}</p>}
              </div>
            )}
          </div>
        </div>
      </header>

      <main id="main-content">
        <Outlet />
      </main>

      <footer className="footer">
        <p className="footer-mark">Rajugari Abbayi</p>
        <p className="footer-tag">every frame with feeling</p>
        <div className="footer-links">
          <a href={instagramUrl} target="_blank" rel="noreferrer">Instagram</a>
          <span className="footer-dot" aria-hidden="true" />
          <a href={`mailto:${contactEmail}`}>Email</a>
          <span className="footer-dot" aria-hidden="true" />
          <Link to="/book">Book a shoot</Link>
        </div>
        <p className="footer-copy">© 2026 Rajugari_Abbayi Photography. Crafted with intention.</p>
      </footer>
    </div>
  )
}

export function Layout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <LayoutInner />
      </AuthProvider>
    </QueryClientProvider>
  )
}
