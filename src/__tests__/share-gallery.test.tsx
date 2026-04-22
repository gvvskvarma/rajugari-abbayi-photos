import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

/**
 * Integration tests for the share-link viewer flow — the most critical
 * customer-facing path. Verifies:
 *   - Happy path: valid token → gallery data
 *   - Expired link: throws with user-visible message
 *   - Invalid token: surfaces error from worker
 *   - Disabled query: when token is undefined
 *
 * Strategy: mock `workerRequest` directly (cleaner than mocking fetch + env).
 */

const mockWorkerRequest = vi.fn()

vi.mock('../hooks/useApi', () => ({
  workerRequest: mockWorkerRequest,
  triggerBrowserDownload: vi.fn(),
  loadWorkerBlob: vi.fn(),
}))

// Import AFTER mocks are set up
const { useShareGallery } = await import('../hooks/queries/useShareGallery')

const wrapper =
  (queryClient: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

describe('useShareGallery', () => {
  let client: QueryClient

  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    mockWorkerRequest.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns gallery data for a valid token', async () => {
    const futureExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    mockWorkerRequest.mockResolvedValueOnce({
      deliveryId: 'delivery-1',
      scopeType: 'all',
      allowDownload: true,
      expiresAt: futureExpiry,
      assets: [
        {
          id: 'asset-1',
          filename: 'photo.jpg',
          mime_type: 'image/jpeg',
          bytes: 1024,
          r2_object_key: 'deliveries/delivery-1/raw/photo.jpg',
        },
      ],
    })

    const { result } = renderHook(() => useShareGallery('valid-token'), {
      wrapper: wrapper(client),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.deliveryId).toBe('delivery-1')
    expect(result.current.data?.assets).toHaveLength(1)
    expect(mockWorkerRequest).toHaveBeenCalledWith(
      '/api/v1/share-links/valid-token/gallery',
      '',
    )
  })

  it('throws a user-visible error for expired links', async () => {
    const pastExpiry = new Date(Date.now() - 1000).toISOString()
    mockWorkerRequest.mockResolvedValueOnce({
      deliveryId: 'delivery-1',
      scopeType: 'all',
      allowDownload: false,
      expiresAt: pastExpiry,
      assets: [],
    })

    const { result } = renderHook(() => useShareGallery('expired-token'), {
      wrapper: wrapper(client),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toBe('This share link has expired.')
  })

  it('surfaces worker-side errors (invalid token, etc.)', async () => {
    mockWorkerRequest.mockRejectedValueOnce(new Error('Invalid share token'))

    const { result } = renderHook(() => useShareGallery('bad-token'), {
      wrapper: wrapper(client),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toBe('Invalid share token')
  })

  it('does not fetch when token is undefined', async () => {
    const { result } = renderHook(() => useShareGallery(undefined), {
      wrapper: wrapper(client),
    })

    // Wait a tick to ensure no call was made
    await new Promise((r) => setTimeout(r, 50))
    expect(mockWorkerRequest).not.toHaveBeenCalled()
    expect(result.current.isPending).toBe(true)
  })
})
