import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'

/**
 * Integration tests for AuthContext — verifies the critical session-gating
 * behavior that was added during pre-release hardening:
 *   - Starts unauthenticated (session null, role customer, loginLabel LOGIN)
 *   - getAccessToken returns empty when no session (prevents stale-token race
 *     where mutations in flight during logout would use expired JWTs)
 *   - getAccessToken DOES NOT call supabase.auth.getSession() when session is null
 *     (confirms the gate short-circuits before hitting the network)
 */

const mockGetSession = vi.fn(async () => ({ data: { session: null } }))
const mockOnAuthStateChange = vi.fn(() => ({
  data: {
    subscription: {
      unsubscribe: vi.fn(),
    },
  },
}))
const mockSignOut = vi.fn(async () => ({ error: null }))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
      signOut: mockSignOut,
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({ data: null })),
        })),
      })),
    })),
  },
  isSupabaseConfigured: true,
}))

const { AuthProvider, useAuthContext } = await import('../context/AuthContext')

describe('AuthContext', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider>{children}</AuthProvider>
  )

  beforeEach(() => {
    mockGetSession.mockClear()
    mockOnAuthStateChange.mockClear()
    mockSignOut.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts unauthenticated with null session, customer role, LOGIN label', () => {
    const { result } = renderHook(() => useAuthContext(), { wrapper })

    expect(result.current.session).toBeNull()
    expect(result.current.role).toBe('customer')
    expect(result.current.loginLabel).toBe('LOGIN')
  })

  it('getAccessToken returns empty string when no session', async () => {
    const { result } = renderHook(() => useAuthContext(), { wrapper })

    const token = await result.current.getAccessToken()
    expect(token).toBe('')
  })

  it('getAccessToken does NOT call supabase.auth.getSession when session is null (prevents stale-token race)', async () => {
    const { result } = renderHook(() => useAuthContext(), { wrapper })

    // Clear the call that happens during mount
    mockGetSession.mockClear()
    const token = await result.current.getAccessToken()

    expect(token).toBe('')
    // This is the gate — short-circuits BEFORE hitting supabase.auth.getSession()
    // so mutations in flight during logout don't continue with expired JWTs.
    expect(mockGetSession).not.toHaveBeenCalled()
  })

  it('registers one onAuthStateChange listener per AuthProvider mount', () => {
    renderHook(() => useAuthContext(), { wrapper })
    // Exactly one — confirming we don't have multiple listeners causing races
    expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1)
  })
})
