import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Role } from '../types'
import { toFirstName } from '../lib/helpers'

type AuthSession = { user: { id: string; email?: string } } | null

interface AuthContextValue {
  session: AuthSession
  role: Role
  profileDisplayName: string
  loginLabel: string
  getAccessToken: () => Promise<string>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useAuthContext() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider')
  return ctx
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession>(null)
  const [role, setRole] = useState<Role>('customer')
  const [profileDisplayName, setProfileDisplayName] = useState('')

  /* Bootstrap + subscribe to Supabase auth changes */
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

  /* Fetch role + display name when session changes */
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

  /* Gate on current session state. During logout or before auth, return empty
     so mutations in flight don't continue with an expired/bogus token.
     Wrapped in useCallback so the memoized context value stays stable. */
  const getAccessToken = useCallback(async () => {
    if (!supabase || !session) return ''
    const {
      data: { session: authSession },
    } = await supabase.auth.getSession()
    return authSession?.access_token ?? ''
  }, [session])

  const value = useMemo<AuthContextValue>(
    () => ({ session, role, profileDisplayName, loginLabel, getAccessToken }),
    [session, role, profileDisplayName, loginLabel, getAccessToken],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
