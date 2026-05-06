import type { Context } from 'hono'
import type { Env } from '../types'

export const resolveAllowedOrigin = (env: Env, requestOrigin?: string): string => {
  const allowList = new Set([env.APP_ORIGIN, 'http://localhost:5173', 'http://localhost:5174'])
  if (requestOrigin && allowList.has(requestOrigin)) return requestOrigin
  return env.APP_ORIGIN || '*'
}

export const buildBaseHeaders = (origin: string) => ({
  'content-type': 'application/json',
  'access-control-allow-origin': origin,
  'access-control-allow-headers': 'content-type,authorization',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
})

export const responseHeaders = (c: Context<{ Bindings: Env }>) =>
  buildBaseHeaders(resolveAllowedOrigin(c.env, c.req.header('Origin')))

export const jsonError = (message: string, status = 400, origin = '*') =>
  new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: buildBaseHeaders(origin),
  })

export const SAFE_ERROR_PATTERNS = [
  /not found/i, /unauthorized/i, /forbidden/i, /expired/i,
  /invalid.*token/i, /login.*session/i, /required/i, /already exists/i,
]

export const supabaseRequest = async <T>(
  env: Env,
  path: string,
  init?: RequestInit,
  useServiceRole = true
): Promise<T> => {
  const url = `${env.SUPABASE_URL}/rest/v1/${path}`
  const apiKey = useServiceRole ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Supabase request failed (${response.status}): ${text}`)
  }

  const text = await response.text()
  if (!text.trim()) return {} as T
  return JSON.parse(text) as T
}
