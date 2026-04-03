export const queryKeys = {
  myDeliveries: (email: string) => ['my-deliveries', email] as const,
  thumbnailBatch: (ids: string[]) => ['thumbnail-batch', ...ids] as const,
  previewUrl: (assetId: string) => ['preview-url', assetId] as const,
  shareGallery: (token: string) => ['share-gallery', token] as const,
  shareThumbnailBatch: (token: string, ids: string[]) => ['share-thumbnail-batch', token, ...ids] as const,
  sharePreviewUrl: (token: string, assetId: string) => ['share-preview-url', token, assetId] as const,
  adminClients: (userId: string) => ['admin-clients', userId] as const,
  adminActivity: (clientId?: string) => ['admin-activity', clientId ?? 'global'] as const,
  adminPreviewBatch: (ids: string[]) => ['admin-preview-batch', ...ids] as const,
} as const
