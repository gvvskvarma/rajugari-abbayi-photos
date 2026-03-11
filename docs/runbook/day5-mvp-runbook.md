# Week 1 Day 5 MVP Runbook

This runbook covers local development, production deployment, and smoke validation for the Week 1 MVP stack.

## Stack

- Frontend: React + TypeScript + Vite (Vercel)
- API: Cloudflare Worker + Hono
- Storage: Cloudflare R2 private bucket + signed URLs
- DB/Auth: Supabase

## Required environment

### Frontend (`.env`)

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL`
- `VITE_FORMSPREE_ENDPOINT` (optional for booking form)

### Worker vars (`worker/wrangler.toml`)

- `APP_ORIGIN`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `R2_ACCOUNT_ID`
- `R2_BUCKET`

### Worker secrets (`wrangler secret put`)

- `SUPABASE_SERVICE_ROLE_KEY`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

## Migration order

Apply Supabase migrations in order:

1. `supabase/migrations/20260305_day1_init.sql`
2. `supabase/migrations/20260310_day2_auth_roles_admin.sql`
3. `supabase/migrations/20260311_day3_upload_pipeline.sql`
4. `supabase/migrations/20260311_day4_delivery_security.sql`

## Local run

```bash
npm install
npm run dev

cd worker
npm install
npm run dev
```

## Production deploy

### Worker

```bash
cd worker
npm run deploy
```

Expected route pattern:
- `https://<worker-name>.<workers-subdomain>.workers.dev`

### Frontend

```bash
npx vercel deploy --prod --yes
```

## Day 5 smoke checks

```bash
npm run build
cd worker && npx tsc --noEmit
curl -sS https://photography-api.gvvskvarma-account.workers.dev/api/v1/health
curl -I https://rajugariabbayishots.vercel.app/
```

## Operational notes

- `POST /api/v1/media/signed-url` enforces delivery-level and per-file access controls.
- Signed download URL issuance records `download_events`.
- Basic route-level rate limits are active in Worker middleware.
- Keep `.env` and `worker/.dev.vars` local-only; do not commit secrets.
