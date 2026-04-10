import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { Role } from '../types'
import { toFirstName } from '../lib/helpers'

type AuthSession = { user: { id: string; email?: string } } | null

type UseAuthOptions = {
  onSignOut?: () => void
}

export function useAuth(options?: UseAuthOptions) {
  const [authMenuOpen, setAuthMenuOpen] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [authCodeReady, setAuthCodeReady] = useState(false)
  const [authMessage, setAuthMessage] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [profileDisplayName, setProfileDisplayName] = useState('')
  const [session, setSession] = useState<AuthSession>(null)
  const [role, setRole] = useState<Role>('customer')

  useEffect(() => {
    if (!supabase) return
    const client = supabase

    const boot = async () => {
      const { data } = await client.auth.getSession()
      const nextSession = data.session
      if (!nextSession?.user) {
        setSession(null)
        setRole('customer')
        setProfileDisplayName('')
        return
      }
      setSession({ user: { id: nextSession.user.id, email: nextSession.user.email ?? undefined } })
    }

    void boot()

    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!nextSession?.user) {
        setSession(null)
        setRole('customer')
        setProfileDisplayName('')
        return
      }
      setSession({ user: { id: nextSession.user.id, email: nextSession.user.email ?? undefined } })
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  /* Reset auth UI when session changes (external auth state) */
  useEffect(() => {
    if (!session) return
    setAuthMenuOpen(false)
    setAuthCode('')
    setAuthCodeReady(false)
    setAuthMessage('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id])

  useEffect(() => {
    if (!supabase || !session?.user.id) return
    const client = supabase

    const fetchRole = async () => {
      const { data } = await client
        .from('profiles')
        .select('role, display_name')
        .eq('id', session.user.id)
        .single()

      if (!data) {
        setRole('customer')
        setProfileDisplayName('')
        return
      }

      setRole(data.role === 'admin' ? 'admin' : 'customer')
      setProfileDisplayName(data.display_name ?? '')
    }

    void fetchRole()
  }, [session?.user.id])

  const loginLabel = useMemo(() => {
    if (!session) return 'LOGIN'
    return toFirstName(profileDisplayName) || toFirstName(session.user.email) || 'LOGIN'
  }, [profileDisplayName, session])

  const getAccessToken = async () => {
    if (!supabase) return ''
    const {
      data: { session: authSession },
    } = await supabase.auth.getSession()
    return authSession?.access_token ?? ''
  }

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
    session,
    role,
    profileDisplayName,
    loginLabel,
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
    getAccessToken,
  }
}
