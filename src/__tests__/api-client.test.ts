import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Unit-integration tests for workerRequest — the core HTTP helper every
 * query/mutation in the app uses. Verifies:
 *   - Happy path GET + POST
 *   - Bearer token header
 *   - Error body extraction (uses worker's error.message format)
 *   - Non-JSON error response handling
 */

vi.mock('../lib/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/constants')>()
  return { ...actual, apiBaseUrl: 'https://api.test.local' }
})

const { workerRequest } = await import('../hooks/useApi')

const originalFetch = globalThis.fetch

describe('workerRequest', () => {
  beforeEach(() => {
    // fresh fetch mock per test
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('performs a GET with bearer token and returns parsed JSON', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, count: 42 }), { status: 200 }),
    )

    const result = await workerRequest<{ ok: boolean; count: number }>(
      '/api/v1/me',
      'jwt-abc',
    )

    expect(result).toEqual({ ok: true, count: 42 })
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.test.local/api/v1/me',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          authorization: 'Bearer jwt-abc',
          'content-type': 'application/json',
        }),
      }),
    )
  })

  it('sends POST body as JSON', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 201 }),
    )

    await workerRequest('/api/v1/admin/clients', 'jwt-abc', {
      method: 'POST',
      body: { fullName: 'Test Client', email: 'test@example.com' },
    })

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const init = call[1]
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      fullName: 'Test Client',
      email: 'test@example.com',
    })
  })

  it('extracts error.message from worker JSON error bodies', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: 'Delivery has expired' } }),
        { status: 403 },
      ),
    )

    await expect(
      workerRequest('/api/v1/deliveries/xyz/gallery', 'jwt-abc'),
    ).rejects.toThrow('Delivery has expired')
  })

  it('falls back to generic message for non-JSON error responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Gateway Timeout', { status: 504 }),
    )

    await expect(workerRequest('/api/v1/anything', 'jwt')).rejects.toThrow(
      'Gateway Timeout',
    )
  })
})
