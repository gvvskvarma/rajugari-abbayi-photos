import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import '../App.css'
import { isSupabaseConfigured } from '../lib/supabase'
import { useAuthContext } from '../context/AuthContext'
import { useAuth } from '../hooks/useAuth'
import { useLiveConfig } from '../hooks/queries/useLiveConfig'
import { personalInstagramUrl } from '../lib/constants'
import { queryClient } from '../lib/queryClient'
import { AuthProvider } from '../context/AuthContext'
import { pageTransition, pageTransitionDuration } from '../lib/motion'

/**
 * Public, content-leaning routes get a subtle fade + Y-shift transition on
 * navigation. Tool-style routes (admin / upload / my-pictures / share) opt
 * out — motion there reads as friction.
 */
const ANIMATED_PATHS = new Set<string>([
  '/',
  '/work',
  '/portfolio',
  '/about',
  '/live',
  '/book',
])

function AnimatedOutlet() {
  const location = useLocation()
  const reduceMotion = useReducedMotion()

  // Tool/admin pages skip the transition entirely
  const shouldAnimate = ANIMATED_PATHS.has(location.pathname) && !reduceMotion

  if (!shouldAnimate) return <Outlet />

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        variants={pageTransition}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={pageTransitionDuration}
      >
        <Outlet />
      </motion.div>
    </AnimatePresence>
  )
}

function LayoutInner() {
  const navigate = useNavigate()
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

  return (
    <div className="page">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <header className="topbar">
        <div className="brand">
          <a className="brand-mark" href="/" aria-label="Go to top">
            <img
              src="/logo/logo-200.png"
              alt="Rajugari_Abbayi Photography logo"
              loading="eager"
            />
          </a>
          <div>
            <a className="brand-title" href="/">
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

        <div className="topbar-right">
          <nav className="nav">
            {session && role === 'customer' && <a href="/my-pictures">My Pictures</a>}
            {session && role === 'admin' && <a href="/upload">Upload</a>}
            {session && role === 'admin' && <a href="/admin/clients">Clients</a>}
            {!(session && role === 'admin') && <a href="/work">Work</a>}
            {!(session && role === 'admin') && <a href="/about">About</a>}
            {(isLive || isAdmin) && <a href="/live">{isLive ? 'Live' : 'Live (off)'}</a>}
            {!(session && role === 'admin') && <a href="/book">Contact</a>}
          </nav>

          <div className="auth-box">
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
        <AnimatedOutlet />
      </main>

      <footer className="footer">
        <p>© 2026 Rajugari_Abbayi Photography. Crafted with intention.</p>
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
