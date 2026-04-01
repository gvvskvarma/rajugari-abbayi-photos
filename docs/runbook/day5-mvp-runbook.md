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
5. `supabase/migrations/20260313_admin_activity.sql`

## Local run

```bash
npm install
npm run dev

cd worker
npm install
npm run dev
```

## Production deploy

### Frontend

Vercel is connected to `main`, so frontend changes deploy automatically on push.

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

Use the manual Vercel deploy only when you need an override or a one-off production push.

### Database

Apply Supabase migrations manually when the schema changes.

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
- Admin audit activity is persisted in `admin_activity_events`.
- Basic route-level rate limits are active in Worker middleware.
- Keep `.env` and `worker/.dev.vars` local-only; do not commit secrets.
