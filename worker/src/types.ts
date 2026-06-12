export type Role = 'admin' | 'customer'
export type Mode = 'view' | 'download'
export type MediaVariant = 'preview' | 'thumb'

export type UploadTokenPayload = {
  v: 1
  uploadId: string
  ownerUserId: string
  deliveryId: string
  projectId: string
  objectKey: string
  originalFilename: string
  mimeType: string
  expectedBytes: number
  issuedAt: string
  expiresAt: string
}

export type PreviewTokenPayload = {
  v: 1
  assetId: string
  deliveryId: string
  issuedAt: string
  expiresAt: string
}

export type DownloadTokenPayload = {
  v: 1
  assetId: string
  deliveryId: string
  r2ObjectKey: string
  filename: string
  mimeType: string
  issuedAt: string
  expiresAt: string
}

/**
 * Authorizes a streamed ZIP download of a whole delivery (or one folder) via a
 * GET URL, so the browser downloads natively — straight to disk, no in-memory
 * buffering (works for multi-GB on iPhone). `folder` null = all downloadable
 * files; a string = only that folder.
 */
export type ZipDownloadTokenPayload = {
  v: 1
  deliveryId: string
  folder: string | null
  filename: string
  issuedAt: string
  expiresAt: string
}

/**
 * Admin-side native ZIP download of a whole project (folder). Token encodes
 * the owning admin + project so the GET endpoint can resolve and stream
 * without a bearer header (native navigation).
 */
export type ProjectZipDownloadTokenPayload = {
  v: 1
  projectId: string
  ownerUserId: string
  filename: string
  issuedAt: string
  expiresAt: string
}

export type PreviewAccessContext =
  | { kind: 'share'; context: ShareLinkContext }
  | { kind: 'user'; user: User }

export type Env = {
  R2_MEDIA_BUCKET: R2Bucket
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  R2_ACCOUNT_ID: string
  R2_BUCKET: string
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
  APP_ORIGIN: string
  /**
   * Optional secret used to HMAC-sign upload/preview/download tokens.
   * If unset, falls back to SUPABASE_SERVICE_ROLE_KEY for backwards compatibility.
   * Should be set to a random 32+ byte value in production so SRK rotation
   * doesn't invalidate live tokens.
   */
  TOKEN_SIGNING_SECRET?: string
  /**
   * Optional Sentry DSN. When set (as a wrangler secret), worker errors are
   * reported to Sentry via HTTP. Leave unset to disable.
   */
  SENTRY_DSN?: string
  /**
   * Resend API key — sends client-notification emails (e.g. "your photos are
   * ready"). Set via `wrangler secret put RESEND_API_KEY`. When unset, the
   * notify endpoint short-circuits with a 503 so deploys don't crash.
   */
  RESEND_API_KEY?: string
  /**
   * From-address for outbound client emails. e.g. "Rajugari Abbayi Shots
   * <hello@yourdomain.com>". The address's domain must be verified in Resend.
   */
  EMAIL_FROM?: string
  /**
   * Retention lifecycle dry-run switch. When "true" (the default if unset),
   * the daily lifecycle cron LOGS what it would warn/soft-delete/purge but
   * performs no writes, sends, or deletions. Set to "false" (wrangler var)
   * only after verifying the dry-run logs look correct.
   */
  LIFECYCLE_DRY_RUN?: string
}

export type User = {
  id: string
  email: string
  role: Role
}

export type AdminActivityKind = 'upload' | 'download' | 'delete' | 'edit' | 'create'

export type AdminActivityRow = {
  id: string
  owner_user_id: string
  actor_profile_id: string | null
  kind: AdminActivityKind
  title: string
  detail: string
  client_id: string | null
  project_id: string | null
  asset_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export type DeliveryAssetRule = {
  assetId: string
  canView: boolean
  canDownload: boolean
}

export type ShareLinkScope = 'all' | 'selected'

export type ShareLinkRow = {
  id: string
  delivery_id: string
  allow_download: boolean
  expires_at: string
  scope_type: ShareLinkScope
}

export type ShareLinkContext = {
  link: ShareLinkRow
  selectedAssetIds: Set<string>
}
