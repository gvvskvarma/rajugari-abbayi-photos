import type { Env } from '../types'

/**
 * Shared magic-link minting for client emails (delivery-ready + expiry
 * warning). Both flows need to (1) ensure the client has an auth user and
 * (2) build a token_hash sign-in link to our /auth/callback route.
 *
 * Why token_hash (not the PKCE action_link): the link is minted server-side
 * and clicked by a client who never started a login in their browser, so
 * there's no PKCE code verifier. token_hash is verified client-side via
 * verifyOtp, which needs no verifier. See AuthCallbackPage on the frontend.
 */

type GenerateLinkResponse = {
  properties?: { action_link?: string; hashed_token?: string }
  action_link?: string
  hashed_token?: string
}

/**
 * Ensure an auth user exists for this email before minting a magic link.
 * generate_link(magiclink) only works for existing users, but most notified
 * clients are brand new. Idempotent: a 422 "already registered" is the
 * expected happy path on repeat sends and is swallowed.
 */
export const ensureAuthUser = async (env: Env, email: string): Promise<void> => {
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, email_confirm: true }),
  })
  if (response.ok) return
  const body = await response.text()
  if (response.status === 422 || /already.*(registered|exist)/i.test(body)) return
  throw new Error(`Supabase create user failed (${response.status}): ${body.slice(0, 200)}`)
}

/**
 * Mint a sign-in `token_hash` via Supabase admin generate_link, then build a
 * link to our /auth/callback route (which verifies it and forwards to `next`).
 *
 * Call `ensureAuthUser` first — magiclink requires the user to exist.
 * Expiry is governed by the project's Auth → Email OTP setting (1 hour).
 *
 * `next` is a same-site path the callback forwards to after sign-in.
 */
export const generateSignInLink = async (
  env: Env,
  email: string,
  next = '/my-pictures'
): Promise<string> => {
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Supabase generate_link failed (${response.status}): ${body.slice(0, 200)}`)
  }
  const payload = (await response.json()) as GenerateLinkResponse
  const tokenHash = payload.properties?.hashed_token ?? payload.hashed_token
  if (!tokenHash) throw new Error('Supabase generate_link returned no hashed_token')

  /* type=email is the canonical verifyOtp type for a magic-link token_hash
     (per Supabase docs) — NOT "magiclink", which fails verification. */
  return `${env.APP_ORIGIN}/auth/callback?token_hash=${encodeURIComponent(tokenHash)}&type=email&next=${encodeURIComponent(next)}`
}
