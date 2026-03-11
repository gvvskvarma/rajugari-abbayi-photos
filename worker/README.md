# Photography Worker API

Cloudflare Worker + Hono backend for secure upload/share delivery.

## Endpoints

- `GET /api/v1/health`
- `POST /api/v1/request-upload-url`
- `POST /api/v1/upload/request`
- `POST /api/v1/upload/complete`
- `POST /api/v1/media/signed-url`
- `POST /api/v1/share-links`
- `GET /api/v1/my-pictures`

## Security behavior

- Role-aware access via Supabase JWT + `profiles.role`.
- Admin-only upload URL issuing.
- Upload sessions are tokenized and expire in 15 minutes.
- Viewer share links cannot request download mode.
- Signed URLs are short-lived (5 to 15 minutes).
- Retention enforcement checks `delivery_recipients.expires_at`.

## Required Worker secrets

```bash
cd worker
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

## Required Worker vars

Set in `wrangler.toml` or dashboard:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
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
