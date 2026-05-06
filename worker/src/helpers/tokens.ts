import type { DownloadTokenPayload, PreviewTokenPayload, UploadTokenPayload, Env } from '../types'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const uploadTokenVersion = 'v1'
const previewTokenVersion = 'v1'
const downloadTokenVersion = 'dt1'

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const base64UrlEncode = (value: string) => bytesToBase64Url(textEncoder.encode(value))

const base64UrlDecode = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return textDecoder.decode(bytes)
}

/**
 * Resolve the secret used to HMAC-sign tokens.
 * Prefers TOKEN_SIGNING_SECRET if set; otherwise falls back to SUPABASE_SERVICE_ROLE_KEY
 * for backwards compatibility with existing deployments.
 */
export const getTokenSigningSecret = (env: Env): string =>
  env.TOKEN_SIGNING_SECRET || env.SUPABASE_SERVICE_ROLE_KEY

const signToken = async (version: string, secret: string, payloadB64: string) => {
  const key = await crypto.subtle.importKey(
    'raw', textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(`${version}.${payloadB64}`))
  return bytesToBase64Url(new Uint8Array(signature))
}

export const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  const aBuf = textEncoder.encode(a)
  const bBuf = textEncoder.encode(b)
  let mismatch = 0
  for (let i = 0; i < aBuf.length; i++) mismatch |= aBuf[i] ^ bBuf[i]
  return mismatch === 0
}

export const createUploadToken = async (secret: string, payload: UploadTokenPayload) => {
  const payloadB64 = base64UrlEncode(JSON.stringify(payload))
  const signature = await signToken(uploadTokenVersion, secret, payloadB64)
  return `${uploadTokenVersion}.${payloadB64}.${signature}`
}

export const verifyUploadToken = async (secret: string, token: string): Promise<UploadTokenPayload> => {
  const [version, payloadB64, signature] = token.split('.')
  if (version !== uploadTokenVersion || !payloadB64 || !signature) throw new Error('Invalid upload token')
  const expectedSignature = await signToken(uploadTokenVersion, secret, payloadB64)
  if (!timingSafeEqual(expectedSignature, signature)) throw new Error('Invalid upload token')
  const payload = JSON.parse(base64UrlDecode(payloadB64)) as UploadTokenPayload
  if (!payload.v || !payload.uploadId || !payload.ownerUserId || !payload.deliveryId || !payload.projectId || !payload.objectKey || !payload.originalFilename || !payload.mimeType || !payload.expectedBytes || !payload.issuedAt || !payload.expiresAt) throw new Error('Invalid upload token')
  if (new Date(payload.expiresAt).getTime() <= Date.now()) throw new Error('Upload session expired')
  return payload
}

export const createPreviewToken = async (secret: string, payload: PreviewTokenPayload) => {
  const payloadB64 = base64UrlEncode(JSON.stringify(payload))
  const signature = await signToken(previewTokenVersion, secret, payloadB64)
  return `${previewTokenVersion}.${payloadB64}.${signature}`
}

export const verifyPreviewToken = async (secret: string, token: string): Promise<PreviewTokenPayload> => {
  const [version, payloadB64, signature] = token.split('.')
  if (version !== previewTokenVersion || !payloadB64 || !signature) throw new Error('Invalid preview token')
  const expectedSignature = await signToken(previewTokenVersion, secret, payloadB64)
  if (!timingSafeEqual(expectedSignature, signature)) throw new Error('Invalid preview token')
  const payload = JSON.parse(base64UrlDecode(payloadB64)) as PreviewTokenPayload
  if (!payload.v || !payload.assetId || !payload.deliveryId || !payload.issuedAt || !payload.expiresAt) throw new Error('Invalid preview token')
  if (new Date(payload.expiresAt).getTime() <= Date.now()) throw new Error('Preview token expired')
  return payload
}

export const createDownloadToken = async (secret: string, payload: DownloadTokenPayload) => {
  const payloadB64 = base64UrlEncode(JSON.stringify(payload))
  const signature = await signToken(downloadTokenVersion, secret, payloadB64)
  return `${downloadTokenVersion}.${payloadB64}.${signature}`
}

export const verifyDownloadToken = async (secret: string, token: string): Promise<DownloadTokenPayload> => {
  const [version, payloadB64, signature] = token.split('.')
  if (version !== downloadTokenVersion || !payloadB64 || !signature) throw new Error('Invalid download token')
  const expectedSignature = await signToken(downloadTokenVersion, secret, payloadB64)
  if (!timingSafeEqual(expectedSignature, signature)) throw new Error('Invalid download token')
  const payload = JSON.parse(base64UrlDecode(payloadB64)) as DownloadTokenPayload
  if (!payload.v || !payload.assetId || !payload.deliveryId || !payload.r2ObjectKey || !payload.issuedAt || !payload.expiresAt) throw new Error('Invalid download token')
  if (new Date(payload.expiresAt).getTime() <= Date.now()) throw new Error('Download token expired')
  return payload
}
