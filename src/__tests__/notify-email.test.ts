import { describe, it, expect, vi, beforeEach } from 'vitest'
/**
 * The email helper lives in worker/src/ rather than the frontend src/, but
 * the `renderDeliveryReadyEmail` function is pure (no Cloudflare-only APIs),
 * so we import it via relative path. This lets us validate the HTML-escape
 * logic — which is the actual security-sensitive part — without standing up
 * a separate Vitest project for the worker.
 *
 * The `sendDeliveryReady` function uses global `fetch` and is also testable
 * here by mocking fetch on the global.
 */
import {
  renderDeliveryReadyEmail,
  sendDeliveryReady,
  renderExpiryWarningEmail,
  type DeliveryReadyEmailInput,
  type ExpiryWarningEmailInput,
} from '../../worker/src/helpers/email'

const baseInput: DeliveryReadyEmailInput = {
  to: 'client@example.com',
  clientName: 'Aarav',
  deliveryTitle: 'Diwali 2026',
  magicLink: 'https://app.example.com/auth/verify?token=abc&type=magiclink',
  assetCount: 42,
}

describe('renderDeliveryReadyEmail', () => {
  it('includes the client name in the greeting', () => {
    const { html, text } = renderDeliveryReadyEmail(baseInput)
    expect(html).toContain('Aarav')
    expect(text).toContain('Aarav')
  })

  it('falls back to "there" when client name is empty', () => {
    const { html, text } = renderDeliveryReadyEmail({ ...baseInput, clientName: '' })
    expect(html).toContain('there')
    expect(text).toContain('there')
  })

  it('shows the photo count when assetCount > 0', () => {
    const { html, text } = renderDeliveryReadyEmail({ ...baseInput, assetCount: 1 })
    expect(html).toContain('1 photo')
    expect(text).toContain('1 photo')
    expect(html).not.toContain('1 photos')
  })

  it('pluralises photos correctly', () => {
    const { html } = renderDeliveryReadyEmail({ ...baseInput, assetCount: 42 })
    expect(html).toContain('42 photos')
  })

  it('omits the count when assetCount is zero', () => {
    const { html, text } = renderDeliveryReadyEmail({ ...baseInput, assetCount: 0 })
    expect(html).toContain('Your photos from')
    expect(text).toContain('Your photos from')
    expect(html).not.toContain('0 photos')
  })

  it('embeds the magic link in both the CTA and the fallback text', () => {
    const link = baseInput.magicLink
    /* `&` in an HTML attribute or text node must be encoded as `&amp;` per
       HTML spec — email clients decode it back to `&` at render time. The
       plain-text body keeps the raw URL. */
    const escapedLink = link.replace(/&/g, '&amp;')
    const { html, text } = renderDeliveryReadyEmail(baseInput)
    expect(html).toContain(`href="${escapedLink}"`)
    /* And in the visible fallback paragraph for clients whose email
       client strips the styled button */
    expect(html.indexOf(escapedLink)).not.toBe(html.lastIndexOf(escapedLink))
    expect(text).toContain(link)
  })

  it('html-escapes the delivery title to prevent injection', () => {
    const malicious = '<script>alert(1)</script>'
    const { html } = renderDeliveryReadyEmail({ ...baseInput, deliveryTitle: malicious })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('html-escapes the client name', () => {
    const { html } = renderDeliveryReadyEmail({ ...baseInput, clientName: 'A & B' })
    expect(html).toContain('A &amp; B')
    expect(html).not.toContain('A & B<')
  })

  it('uses photographerName when provided', () => {
    const { html, text } = renderDeliveryReadyEmail({ ...baseInput, photographerName: 'Karthik' })
    expect(html).toContain('Karthik')
    expect(text).toContain('Karthik')
  })

  it('states the retention window (defaults to 45 days)', () => {
    const { html, text } = renderDeliveryReadyEmail(baseInput)
    expect(html).toContain('45 days')
    expect(text).toContain('45 days')
  })

  it('honours a custom retentionDays', () => {
    const { html } = renderDeliveryReadyEmail({ ...baseInput, retentionDays: 60 })
    expect(html).toContain('60 days')
  })
})

describe('renderExpiryWarningEmail', () => {
  const warnInput: ExpiryWarningEmailInput = {
    to: 'client@example.com',
    clientName: 'Aarav',
    deliveryTitle: 'Diwali 2026',
    magicLink: 'https://app.example.com/auth/callback?token_hash=abc&type=email&next=%2Fmy-pictures',
    removalDate: 'June 15, 2026',
    daysLeft: 3,
  }

  it('states the exact removal date and days left', () => {
    const { html, text } = renderExpiryWarningEmail(warnInput)
    expect(html).toContain('June 15, 2026')
    expect(html).toContain('3 days')
    expect(text).toContain('June 15, 2026')
  })

  it('singularises "1 day"', () => {
    const { html } = renderExpiryWarningEmail({ ...warnInput, daysLeft: 1 })
    expect(html).toContain('1 day')
    expect(html).not.toContain('1 days')
  })

  it('embeds the magic link in CTA and fallback', () => {
    const escaped = warnInput.magicLink.replace(/&/g, '&amp;')
    const { html, text } = renderExpiryWarningEmail(warnInput)
    expect(html).toContain(`href="${escaped}"`)
    expect(html.indexOf(escaped)).not.toBe(html.lastIndexOf(escaped))
    expect(text).toContain(warnInput.magicLink)
  })

  it('html-escapes the delivery title', () => {
    const { html } = renderExpiryWarningEmail({ ...warnInput, deliveryTitle: '<script>x</script>' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('sendDeliveryReady', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('throws when RESEND_API_KEY is missing', async () => {
    /* Cast through unknown to a minimal Env-shaped stub; the helper only
       reads RESEND_API_KEY and EMAIL_FROM. */
    const env = { EMAIL_FROM: 'a@b.com' } as unknown as Parameters<typeof sendDeliveryReady>[0]
    await expect(sendDeliveryReady(env, baseInput)).rejects.toThrow(/not configured/i)
  })

  it('throws when EMAIL_FROM is missing', async () => {
    const env = { RESEND_API_KEY: 'rs_test' } as unknown as Parameters<typeof sendDeliveryReady>[0]
    await expect(sendDeliveryReady(env, baseInput)).rejects.toThrow(/not configured/i)
  })

  it('throws on invalid recipient', async () => {
    const env = { RESEND_API_KEY: 'rs_test', EMAIL_FROM: 'a@b.com' } as unknown as Parameters<typeof sendDeliveryReady>[0]
    await expect(sendDeliveryReady(env, { ...baseInput, to: '' })).rejects.toThrow(/recipient/i)
    await expect(sendDeliveryReady(env, { ...baseInput, to: 'not-an-email' })).rejects.toThrow(/recipient/i)
  })

  it('POSTs to Resend with the expected payload shape and returns the message id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'msg_abc123' }), { status: 200 })
    )
    const env = {
      RESEND_API_KEY: 'rs_test',
      EMAIL_FROM: 'Rajugari Abbayi <hello@example.com>',
    } as unknown as Parameters<typeof sendDeliveryReady>[0]

    const result = await sendDeliveryReady(env, baseInput)

    expect(result.messageId).toBe('msg_abc123')
    expect(result.sentAt).toMatch(/\d{4}-\d{2}-\d{2}T/)

    /* Verify the call shape — Resend expects from/to/subject/html/text. */
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init?.method).toBe('POST')
    const headers = init?.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer rs_test')
    expect(headers['content-type']).toBe('application/json')
    const body = JSON.parse(init?.body as string)
    expect(body.from).toBe('Rajugari Abbayi <hello@example.com>')
    expect(body.to).toEqual(['client@example.com'])
    expect(body.subject).toContain('Diwali 2026')
    expect(body.html).toContain('Aarav')
    expect(body.text).toContain('Aarav')
    expect(body.tags).toEqual([{ name: 'kind', value: 'delivery_ready' }])
  })

  it('throws with status context when Resend returns non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"name":"validation_error","message":"bad from"}', { status: 422 })
    )
    const env = {
      RESEND_API_KEY: 'rs_test',
      EMAIL_FROM: 'bad-domain@unverified.com',
    } as unknown as Parameters<typeof sendDeliveryReady>[0]
    await expect(sendDeliveryReady(env, baseInput)).rejects.toThrow(/422/)
  })
})
