import type { AdminActivityKind, DeliveryAssetRule, Env, Mode, PreviewAccessContext, Role, ShareLinkContext, ShareLinkRow, User } from '../types'
import { supabaseRequest } from './http'

export const getUserFromBearer = async (env: Env, authHeader?: string): Promise<User> => {
  if (!authHeader?.startsWith('Bearer ')) throw new Error('Missing bearer token')
  const jwt = authHeader.slice('Bearer '.length)
  const authRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
  })
  if (!authRes.ok) throw new Error('Invalid session token')
  const authUser = (await authRes.json()) as { id: string; email?: string }
  const email = (authUser.email ?? '').toLowerCase()
  if (!email) throw new Error('Email not available in session')
  const profiles = await supabaseRequest<Array<{ role: Role }>>(env, `profiles?id=eq.${encodeURIComponent(authUser.id)}&select=role&limit=1`)
  const role = profiles[0]?.role === 'admin' ? 'admin' : 'customer'
  return { id: authUser.id, email, role }
}

export const ensureAdmin = (user: User) => {
  if (user.role !== 'admin') throw new Error('Admin access required')
}

export const ensureDeliveryAccess = async (
  env: Env, user: User, deliveryId: string, mode: Mode
): Promise<'owner' | 'viewer' | 'admin'> => {
  if (user.role === 'admin') {
    const adminDeliveries = await supabaseRequest<Array<{ id: string }>>(env, `deliveries?id=eq.${encodeURIComponent(deliveryId)}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`)
    if (adminDeliveries[0]) return 'admin'
  }
  const recipients = await supabaseRequest<Array<{ access_mode: 'owner' | 'viewer'; expires_at: string | null }>>(env, `delivery_recipients?delivery_id=eq.${encodeURIComponent(deliveryId)}&email=eq.${encodeURIComponent(user.email)}&select=access_mode,expires_at&limit=1`)
  const recipient = recipients[0]
  if (!recipient) throw new Error('No access to this delivery')
  if (recipient.expires_at && new Date(recipient.expires_at).getTime() <= Date.now()) throw new Error('Delivery has expired')
  if (mode === 'download' && recipient.access_mode !== 'owner') throw new Error('Download not allowed for viewer access')
  return recipient.access_mode
}

export const ensureAdminAndOwnedDelivery = async (env: Env, user: User, deliveryId: string) => {
  if (user.role !== 'admin') throw new Error('Admin access required')
  const deliveries = await supabaseRequest<Array<{ id: string }>>(env, `deliveries?id=eq.${encodeURIComponent(deliveryId)}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`)
  if (!deliveries[0]) throw new Error('Delivery not found or not owned by admin')
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_RE.test(value)

export const filterUuids = (values: unknown[]): string[] =>
  values.filter(isUuid)

export const ensureDeliveryAssetMapping = async (env: Env, deliveryId: string, assetId: string) => {
  const existing = await supabaseRequest<Array<{ asset_id: string }>>(
    env,
    `delivery_assets?delivery_id=eq.${encodeURIComponent(deliveryId)}&asset_id=eq.${encodeURIComponent(assetId)}&select=asset_id&limit=1`
  )
  if (existing[0]) return
  await supabaseRequest(
    env,
    'delivery_assets',
    {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ delivery_id: deliveryId, asset_id: assetId }),
    },
    true
  )
}

export const ensureAdminOwnedAsset = async (env: Env, user: User, assetId: string) => {
  ensureAdmin(user)
  const assets = await supabaseRequest<Array<{ id: string; r2_object_key: string }>>(env, `assets?id=eq.${encodeURIComponent(assetId)}&owner_user_id=eq.${encodeURIComponent(user.id)}&select=id,r2_object_key&limit=1`)
  const asset = assets[0]
  if (!asset) throw new Error('Asset not found or not owned by admin')
  return asset
}

export const getShareLinkContext = async (env: Env, token: string): Promise<ShareLinkContext | null> => {
  const links = await supabaseRequest<Array<ShareLinkRow>>(env, `share_links?token=eq.${encodeURIComponent(token)}&select=id,delivery_id,allow_download,expires_at,scope_type&limit=1`)
  const link = links[0]
  if (!link) return null
  const selectedAssetIds = link.scope_type === 'selected'
    ? new Set((await supabaseRequest<Array<{ asset_id: string }>>(env, `share_link_assets?share_link_id=eq.${encodeURIComponent(link.id)}&select=asset_id`)).map((row) => row.asset_id))
    : new Set<string>()
  return { link, selectedAssetIds }
}
