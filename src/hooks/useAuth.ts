import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthContext } from '../context/AuthContext'

type UseAuthOptions = {
  onSignOut?: () => void
}

/**
 * Auth UI hook — used exclusively by Layout for the login/logout menu.
 * Core session/role/getAccessToken live in AuthContext.
 */
export function useAuth(options?: UseAuthOptions) {
  const { session } = useAuthContext()

  const [authMenuOpen, setAuthMenuOpen] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [authCodeReady, setAuthCodeReady] = useState(false)
  const [authMessage, setAuthMessage] = useState('')
  const [authBusy, setAuthBusy] = useState(false)

  /* Reset auth UI when session changes (external auth state) */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!session) return
    setAuthMenuOpen(false)
    setAuthCode('')
    setAuthCodeReady(false)
    setAuthMessage('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id])
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSendOtp = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase) {
      setAuthMessage('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env to enable login.')
      return
    }

    const email = emailInput.trim().toLowerCase()
    if (!email) {
      setAuthMessage('Enter an email address first.')
      return
    }

    setAuthBusy(true)
    setAuthMessage('')
    setAuthCode('')
    setAuthCodeReady(false)

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
      },
    })

    if (error) {
      setAuthMessage(error.message)
    } else {
      setAuthMessage('Code sent. Open email on any device and enter the code here.')
      setAuthCodeReady(true)
    }

    setAuthBusy(false)
  }

  const handleVerifyOtp = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase) {
      setAuthMessage('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env to enable login.')
      return
    }

    const email = emailInput.trim().toLowerCase()
    const token = authCode.trim().replace(/\s+/g, '')
    if (!email) {
      setAuthMessage('Enter an email address first.')
      return
    }
    if (!token) {
      setAuthMessage('Enter the code from your email.')
      return
    }

    setAuthBusy(true)
    setAuthMessage('')

    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    })

    if (error) {
      setAuthMessage(error.message)
    } else {
      setAuthMessage('Code verified. Finishing login...')
    }

    setAuthBusy(false)
  }

  const handleSignOut = async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    setAuthMenuOpen(false)
    setAuthCode('')
    setAuthCodeReady(false)
    setAuthMessage('')
    options?.onSignOut?.()
  }

  return {
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
  }
}
