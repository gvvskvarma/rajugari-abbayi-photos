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
