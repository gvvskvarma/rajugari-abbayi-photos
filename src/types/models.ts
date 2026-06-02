export type Role = 'admin' | 'customer'

export type ShareLinkScope = 'all' | 'selected'

export type DeliveryAsset = {
  id: string
  filename: string
  mime_type: string
  bytes: number
  delivery_id?: string
  r2_object_key?: string
  created_at?: string
  folder?: string | null
  canView?: boolean
  canDownload?: boolean
}

export type DeliveryCard = {
  deliveryId: string
  projectName?: string | null
  clientName?: string | null
  projectStatus?: string | null
  expiresAt: string | null
  firstViewedAt?: string | null
  accessMode?: 'owner' | 'viewer' | 'admin'
  assets: DeliveryAsset[]
}

export type CustomerLightboxState = {
  deliveryId: string
  assetId: string
}

export type AdminClient = {
  id: string
  full_name: string
  email: string
  phone: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type AdminProject = {
  id: string
  client_id: string
  name: string
  description: string | null
  shoot_date: string | null
  location: string | null
  status: string
  created_at: string
  updated_at: string
}

export type AdminAsset = {
  id: string
  project_id: string
  delivery_id: string | null
  filename: string
  mime_type: string
  bytes: number
  r2_object_key: string
  created_at: string
  folder?: string | null
}

export type AdminClientSummary = AdminClient & {
  projects: AdminProject[]
  assets: AdminAsset[]
  projectCount: number
  assetCount: number
  latestUpdatedAt: string
}

export type AdminProjectView = {
  project: AdminProject
  totalAssets: number
  visibleAssets: AdminAsset[]
  latestActivityAt: string
}

export type AdminLightboxState = {
  projectId: string
  assetId: string
}

export type DeleteConfirmationState = {
  title: string
  description: string
  confirmLabel: string
  progressLabel: string
  onConfirm: () => Promise<void>
}

export type AdminActivityKind = 'upload' | 'download' | 'delete' | 'edit' | 'create'

export type AdminActivityItem = {
  id: string
  kind: AdminActivityKind
  title: string
  detail: string
  createdAt: string
  clientId?: string | null
  projectId?: string | null
  assetId?: string | null
  metadata?: Record<string, unknown>
}
