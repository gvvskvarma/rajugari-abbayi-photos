# Client notification setup — Resend + Cloudflare Registrar

This feature sends a branded "your photos are ready" email to the client
when you click **Send notification email** on the upload page. The email
contains a Supabase magic link that signs the client in on click and lands
them on `/my-pictures`.

The worker code is shipped. To turn it on, you need to:

1. Buy a domain (~$10/yr)
2. Sign up at Resend (free) and verify the domain
3. (No change) OTP expiry stays at Supabase's recommended 1 hour
4. Set two secrets on the Cloudflare Worker
5. Redeploy the worker

Total time: ~30 minutes of clicking + 1 hour of DNS propagation while you
do something else.

---

## Step 1 — Buy a domain at Cloudflare Registrar

Cloudflare Registrar sells `.com` domains at wholesale cost (~$9–10/year)
with no markup. Since you already use Cloudflare for the Worker, DNS lives
in the same dashboard.

1. Go to https://dash.cloudflare.com/
2. Sidebar → **Domain Registration** → **Register Domains**
3. Search for the name you want (e.g. `rajugariabbayi.com`, `rgaphotos.com`)
4. Add to cart → checkout → pay

After purchase, the domain shows up in your Cloudflare dashboard as a
regular zone with DNS hosting included.

---

## Step 2 — Sign up at Resend and verify the domain

1. https://resend.com → **Sign up** (free)
2. After login, **Domains** → **Add Domain** → enter your domain
3. Resend gives you 3 DNS records — TXT (SPF), TXT (DKIM), TXT (DMARC).
   They look like this:

   | Type | Name | Value |
   |------|------|-------|
   | TXT  | `send` | `v=spf1 include:amazonses.com ~all` |
   | TXT  | `resend._domainkey` | `p=MIGfMA0GCSq...` (long string) |
   | TXT  | `_dmarc` | `v=DMARC1; p=none;` |

   *(Exact values come from your Resend dashboard — copy them from there.)*

4. Back in Cloudflare → your domain → **DNS** → **Records** → **Add record**
5. Add all 3 records exactly as Resend gave them. Make sure the proxy
   status is **DNS only** (gray cloud), not Proxied.
6. Wait — DNS usually propagates in 5–30 minutes. Resend will mark each
   record as ✓ Verified when it sees them.
7. Once all 3 are verified, the domain is ready to send from.

8. Resend → **API Keys** → **Create API Key**
   - Name: `photography-worker`
   - Permission: **Sending access** (limits blast radius if the key leaks)
   - Domain: pick the one you just verified
   - Copy the key (`re_...`) — you'll only see it once.

---

## Step 3 — OTP expiry stays at 1 hour

Supabase recommends an OTP/magic-link expiry of **≤1 hour (3600s)** for
security — a longer window gives attackers more time to brute-force, so
Supabase flags anything higher. We keep 1 hour, and the email copy says
"1 hour" to match.

No action needed. If a client opens the email after the link expires,
the email tells them to reply, and you re-send via the **Resend** button
on the upload success card (mints a fresh link).

---

## Step 4 — Set the Cloudflare Worker secrets

Two things to set: the Resend API key (secret) and the from-address (var).

From the repo root:

```bash
cd worker

# Set the Resend API key as a secret (encrypted at rest)
wrangler secret put RESEND_API_KEY
# Paste the re_... key when prompted

# Optional — override the EMAIL_FROM var if you want a different
# address than what's in wrangler.toml. Otherwise edit wrangler.toml.
wrangler secret put EMAIL_FROM
# Paste: "Rajugari Abbayi Photography <hello@yourdomain.com>"
```

Or edit `wrangler.toml` directly and change the `EMAIL_FROM` line under
`[vars]`. Both ways work — secrets are encrypted in Cloudflare's UI,
vars are visible.

---

## Step 5 — Deploy

```bash
cd worker
npx wrangler deploy
```

Wrangler prints the deploy URL. Done.

---

## Verifying end-to-end

1. Open the admin upload page → upload a small test delivery to your own
   email address as the client
2. After upload, you'll see the **Upload complete** card with a **Send
   notification email** button
3. Click it → toast confirms send → check your inbox
4. Click the magic link in the email → you should land on `/my-pictures`
   already signed in and see the delivery

If the email shows `via resend.dev` in the from line, your domain isn't
verified yet — wait for DNS to propagate.

If the click lands you on a Supabase error page like "Email link is
invalid or has expired," the link is more than 1 hour old or was already
used — re-send via the Resend button for a fresh one.

---

## Cost summary

| Item | Cost | Notes |
|------|------|-------|
| Cloudflare Registrar domain | ~$10/yr | Wholesale pricing, no markup |
| Resend free tier | $0 | 100 emails/day, 3,000/month |
| Supabase Auth | $0 | Bundled with free tier |
| Cloudflare Workers | $0 | Already on free tier |
| **Total** | **~$10/yr** | |

3,000 emails/month is enough for ~100 events/month at 30 photos/event.
Well beyond a freelance scale.

---

## When it's NOT configured

If `RESEND_API_KEY` or `EMAIL_FROM` is unset, the notify endpoint returns
503 with a clear error. The upload flow itself still works — only the
"Send notification email" button shows an error. This lets the feature
ship before the domain is set up without breaking production.
