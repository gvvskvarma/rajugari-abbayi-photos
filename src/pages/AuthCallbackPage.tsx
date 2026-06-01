import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { EmailOtpType } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

/**
 * Magic-link callback handler.
 *
 * The client-notification email links here with a `token_hash` minted
 * server-side by the worker (Supabase admin generate_link). We verify that
 * hash with `verifyOtp`, which — unlike the PKCE `?code=` exchange — does
 * NOT require a code verifier in this browser's localStorage. That's the
 * whole point: the link was generated on the server, never in the client's
 * browser, so there is no PKCE verifier to exchange against. verifyOtp
 * establishes the session directly, then we forward to the gallery.
 *
 * URL shape:
 *   /auth/callback?token_hash=...&type=magiclink&next=/my-pictures
 */
export function AuthCallbackPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  /* Guard against double-invocation (React StrictMode in dev). The token is
     single-use — verifying it twice would fail the second attempt. */
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    /* All state updates happen inside this async callback (not synchronously
       in the effect body) to satisfy react-hooks/set-state-in-effect — same
       pattern AuthContext uses. */
    void (async () => {
      if (!supabase) {
        setError('Sign-in is not available right now. Please try again later.')
        return
      }
      const tokenHash = params.get('token_hash')
      /* Default to 'email' — the canonical verifyOtp type for a magic-link
         token_hash (the worker sets type=email explicitly). */
      const type = (params.get('type') ?? 'email') as EmailOtpType
      /* Only allow same-site relative paths — never an attacker-supplied
         absolute or protocol-relative URL (open-redirect guard). */
      const requestedNext = params.get('next') ?? '/my-pictures'
      const next =
        requestedNext.startsWith('/') && !requestedNext.startsWith('//')
          ? requestedNext
          : '/my-pictures'

      if (!tokenHash) {
        setError('This sign-in link is missing its token. Ask for a fresh link.')
        return
      }

      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type,
      })
      if (verifyError) {
        setError(
          verifyError.message ||
            'This sign-in link is invalid or has expired. Reply to the email for a fresh one.',
        )
        return
      }
      /* Session is now set; AuthContext's onAuthStateChange will pick it up.
         Replace history so the back button doesn't return to this callback. */
      navigate(next, { replace: true })
    })()
  }, [params, navigate])

  return (
    <section className="portal-section">
      {error ? (
        <div role="alert">
          <div className="portal-head">
            <div>
              <h2>Sign-in link problem</h2>
              <p className="portal-error">{error}</p>
            </div>
          </div>
          <a className="button ghost" href="/my-pictures">
            Go to sign in
          </a>
        </div>
      ) : (
        <div className="portal-head">
          <div>
            <h2>Signing you in…</h2>
            <p className="portal-hint">One moment while we open your gallery.</p>
          </div>
        </div>
      )}
    </section>
  )
}
