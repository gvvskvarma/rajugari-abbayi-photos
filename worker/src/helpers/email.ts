/**
 * Resend transactional email helper.
 *
 * Resend was picked over Mailgun / SendGrid / SES because (1) it has a real
 * free tier suited to a freelance volume (100/day, 3000/month), (2) the API
 * is a single POST with no SDK to bundle, and (3) modern DX. We hit the REST
 * endpoint directly to keep the Worker bundle small — adding the official
 * SDK would pull in 100kb+ for one POST.
 *
 * Domain setup is required before this works in production: add the domain
 * in Resend's dashboard and add the SPF / DKIM / DMARC records they provide
 * at the registrar. Until that's done, the helper short-circuits with a
 * clear error so deploys don't break.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

/**
 * Narrow shape of the worker env consumed by this helper. We deliberately
 * avoid importing the full `Env` type so the helper stays portable — tests
 * (which run under the frontend tsconfig that doesn't know about
 * Cloudflare-only types like `R2Bucket`) can import this file directly.
 */
export type EmailEnv = {
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
}

export type DeliveryReadyEmailInput = {
  /** Client's email — must be present and look like an email. */
  to: string
  /** Client's first name (or "there" fallback) — drives the greeting. */
  clientName: string
  /** Delivery title — surfaces in subject + body. */
  deliveryTitle: string
  /** Magic-link URL that signs the client in on click. */
  magicLink: string
  /** Total photos in this delivery — shown as social proof. */
  assetCount: number
  /** Photographer's display name — signs the email. */
  photographerName?: string
}

export type EmailSendResult = {
  /** Resend's `id` field — useful for support / debugging deliverability. */
  messageId: string
  /** ISO timestamp recorded at send time so callers don't have to recompute. */
  sentAt: string
}

const MISSING_CONFIG_ERROR = 'Email is not configured. Set RESEND_API_KEY and EMAIL_FROM.'

/**
 * Send the "your photos are ready" email to a client.
 *
 * Throws on:
 *  - missing config (RESEND_API_KEY or EMAIL_FROM unset)
 *  - missing/invalid `to`
 *  - Resend API non-2xx
 *
 * Callers (the notify route) translate these into HTTP errors. We never
 * silently swallow a send failure — a client who didn't get the email is a
 * client who doesn't know their photos exist.
 */
export const sendDeliveryReady = async (
  env: EmailEnv,
  input: DeliveryReadyEmailInput
): Promise<EmailSendResult> => {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new Error(MISSING_CONFIG_ERROR)
  }

  const to = input.to.trim()
  if (!to || !to.includes('@')) {
    throw new Error('Invalid recipient email')
  }

  const subject = `Your photos from ${input.deliveryTitle} are ready ✨`
  const { html, text } = renderDeliveryReadyEmail(input)

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [to],
      subject,
      html,
      text,
      // Resend supports `tags` for analytics — useful later if we want to
      // segment "client delivery" sends vs other notifications.
      tags: [{ name: 'kind', value: 'delivery_ready' }],
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Resend API error (${response.status}): ${body.slice(0, 300)}`)
  }

  const payload = (await response.json()) as { id?: string }
  if (!payload.id) {
    throw new Error('Resend returned a response without an id')
  }

  return { messageId: payload.id, sentAt: new Date().toISOString() }
}

/**
 * Render the HTML + plain-text body for the "delivery ready" email.
 *
 * Inline CSS is intentional — Gmail, Outlook, and Apple Mail all strip or
 * partially apply <style> blocks. Inline is the safe target.
 *
 * The layout is a single-column 600px max-width design that degrades to
 * full-width on mobile. The CTA button uses table-based layout because
 * Outlook ignores `display: inline-block` on anchors in some versions.
 *
 * Exposed as a separate export so tests can assert the rendered HTML
 * without mocking the Resend fetch.
 */
export const renderDeliveryReadyEmail = (input: DeliveryReadyEmailInput) => {
  const greetingName = input.clientName.trim() || 'there'
  const photographer = (input.photographerName ?? 'Vishnu').trim() || 'Vishnu'
  const safeTitle = escapeHtml(input.deliveryTitle)
  const safeName = escapeHtml(greetingName)
  const safeLink = escapeAttr(input.magicLink)
  const photoCount = Math.max(0, Math.floor(input.assetCount))
  const photoCountLine = photoCount > 0
    ? `${photoCount} photo${photoCount === 1 ? '' : 's'} from <strong>${safeTitle}</strong>`
    : `Your photos from <strong>${safeTitle}</strong>`

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your photos are ready</title>
</head>
<body style="margin:0;padding:0;background:#f7f4ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#171411;line-height:1.6;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f7f4ee;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#fffdf8;border-radius:18px;padding:40px 32px;box-shadow:0 12px 40px rgba(18,16,12,0.06);">
          <tr>
            <td style="padding-bottom:24px;">
              <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#0f4d5c;">Rajugari Abbayi Photography</div>
            </td>
          </tr>
          <tr>
            <td>
              <h1 style="margin:0 0 16px;font-size:32px;line-height:1.15;letter-spacing:-0.02em;color:#171411;">Your photos are ready, ${safeName} ✨</h1>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:24px;">
              <p style="margin:0;font-size:16px;color:#5f584f;">${photoCountLine} are now ready to view. Click below to sign in — no password needed.</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="border-radius:999px;background:#d44b24;">
                    <a href="${safeLink}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">View my photos →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:24px;">
              <p style="margin:0 0 8px;font-size:14px;color:#5f584f;">The link signs you in for 1 hour. If it expires, just reply to this email and I'll send a fresh one.</p>
              <p style="margin:0;font-size:13px;color:#8a8278;word-break:break-all;">If the button doesn't work, paste this into your browser:<br><span style="color:#5f584f;">${safeLink}</span></p>
            </td>
          </tr>
          <tr>
            <td style="padding-top:16px;border-top:1px solid #e8e1d4;">
              <p style="margin:0;font-size:15px;color:#171411;">Thanks for trusting me with your moments.</p>
              <p style="margin:4px 0 0;font-size:15px;color:#171411;">— ${escapeHtml(photographer)}</p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:12px;color:#8a8278;">Sent because you booked a photography session. Reply if you need anything.</p>
      </td>
    </tr>
  </table>
</body>
</html>`

  const text = [
    `Your photos are ready, ${greetingName}.`,
    '',
    `${photoCount > 0 ? `${photoCount} photo${photoCount === 1 ? '' : 's'} from ${input.deliveryTitle}` : `Your photos from ${input.deliveryTitle}`} are now ready to view.`,
    'Click the link to sign in — no password needed:',
    input.magicLink,
    '',
    'The link signs you in for 1 hour. If it expires, reply and I will send a fresh one.',
    '',
    'Thanks for trusting me with your moments.',
    `— ${photographer}`,
  ].join('\n')

  return { html, text }
}

/**
 * Escape user-controlled strings before interpolation into HTML text content.
 * Resend's API accepts raw HTML; never assume input is safe.
 */
const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      case "'": return '&#39;'
      default: return ch
    }
  })

/**
 * Escape for use inside an HTML attribute (e.g. href). Stricter than text
 * escape because attribute parsers handle quotes differently.
 */
const escapeAttr = (s: string): string => escapeHtml(s)
