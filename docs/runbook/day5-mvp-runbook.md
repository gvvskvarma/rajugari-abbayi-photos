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
6. `supabase/migrations/20260331_share_link_scopes.sql`

## Local run

```bash
npm install
npm run dev

cd worker
npm install
npm run dev
```

## Production deploy

### Git-backed release flow

Pushes to `main` now trigger the production workflow in `.github/workflows/deploy-production.yml`:

- Vercel handles the frontend deploy from the linked `main` branch
- GitHub Actions runs the Supabase migration deploy
- GitHub Actions deploys the Cloudflare Worker after migrations succeed

Required GitHub Actions secrets:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `CLOUDFLARE_API_TOKEN`

The migration job constructs the production database URL from the Supabase password secret and pushes directly with `supabase db push --db-url`.

### Manual fallback

If the workflow secrets are not configured yet, deploy the runtime layers manually:

```bash
cd worker
npm run deploy
```

Expected route pattern:
- `https://<worker-name>.<workers-subdomain>.workers.dev`

Frontend production deploys are handled by the Vercel `main` branch integration.

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
- The Supabase migration workflow is the authoritative place to deploy schema changes after `main` merges.
