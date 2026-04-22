# Photography Worker API

Cloudflare Worker + Hono backend for secure upload/share delivery.

## Endpoints

- `GET /api/v1/health`
- `POST /api/v1/request-upload-url`
- `POST /api/v1/upload/request`
- `POST /api/v1/upload/complete`
- `GET /api/v1/deliveries/:deliveryId/gallery`
- `POST /api/v1/media/signed-url`
- `POST /api/v1/share-links` (full delivery or selected-file share scope)
- `GET /api/v1/my-pictures`

## Security behavior

- Role-aware access via Supabase JWT + `profiles.role`.
- Admin-only upload URL issuing.
- Upload sessions are tokenized and expire in 15 minutes.
- Per-file delivery access rules are enforced from `delivery_assets`.
- Share links can scope to all files or a selected subset through `share_link_assets`.
- Download URL issuance writes `download_events` logs.
- Viewer share links cannot request download mode.
- Signed URLs are short-lived (5 to 15 minutes).
- Retention enforcement checks `delivery_recipients.expires_at`.
- Route-level rate limits are active with tighter limits on upload/signed-url endpoints.
- CORS allow-list is constrained to `APP_ORIGIN` and local dev origins.

## Required Worker secrets

```bash
cd worker
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

## Optional Worker secrets

```bash
# Dedicated signing secret for upload/preview/download tokens.
# If unset, falls back to SUPABASE_SERVICE_ROLE_KEY.
# Recommended so SRK rotation doesn't invalidate live tokens.
openssl rand -base64 48 | wrangler secret put TOKEN_SIGNING_SECRET

# Sentry error tracking. Paste the DSN from your Sentry project settings.
wrangler secret put SENTRY_DSN

# (Optional but recommended) Move ANON_KEY out of wrangler.toml:
# Current state: SUPABASE_ANON_KEY is in wrangler.toml (it's publishable with
# role=anon, but best practice is to keep all secrets in wrangler secrets).
wrangler secret put SUPABASE_ANON_KEY
# Then delete the SUPABASE_ANON_KEY line from [vars] in wrangler.toml.
```

## Required Worker vars

Set in `wrangler.toml` or dashboard:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (publishable — can also be a secret; see above)
- `R2_ACCOUNT_ID`
- `R2_BUCKET`
- `APP_ORIGIN`

## Local dev

```bash
cd worker
npm install
npm run dev
```

## Deploy

```bash
cd worker
npm run deploy
```
