# Rajugari_Abbayi Photography

A React + TypeScript portfolio with externalized media URLs, synchronized rotating galleries, and a booking enquiry form.

## Getting started

```bash
npm install
npm run dev
```

## Media hosting

The app resolves images in this order:
- Remote CDN/storage (when `VITE_MEDIA_BASE_URL` is set)
- Local files from `project-rga/...` (default fallback)

Set this in `.env` only if you want remote hosting:

```bash
VITE_MEDIA_BASE_URL=https://cdn.jsdelivr.net/gh/gvvskvarma/rajugari-abbayi-photos@main
```

Notes:
- `VITE_MEDIA_BASE_URL` should be the parent path that contains `project-rga/...` folders.
- The app currently expects paths like `project-rga/landscapes/...` and `project-rga/potraits/...`.
- If remote files fail, the app falls back to local files automatically.
- For best performance, use optimized/resized derivatives in your CDN instead of original high-res files.

Generate optimized derivatives from originals:

```bash
./scripts/generate-optimized-images.sh
```

This creates `640/1200/1800` JPEG variants in `project-rga/optimized/...`.

## Booking form (Formspree)

Set your Formspree endpoint in `.env`:

```bash
VITE_FORMSPREE_ENDPOINT=https://formspree.io/f/yourFormId
```

The booking page lives at `/book.html`.

## Tech stack

- React + TypeScript
- Vite

## Week 1 backend architecture artifacts

Day 1 planning artifacts for the platform stack (Cloudflare Workers + Hono + R2 + Supabase) are included here:

- Supabase schema migration: `supabase/migrations/20260305_day1_init.sql`
- API contract: `docs/api/day1-api-contract.md`
- Environment template: `.env.example`

Day 2-4 delivery/auth baseline artifacts:

- Supabase migration: `supabase/migrations/20260307_day2_role_delivery.sql`
- Flow/API notes: `docs/api/day2-customer-admin-flow.md`

## App routes for role-aware flow

- `/#home`: portfolio page (unchanged)
- `/#my-pictures`: customer delivery view (email OTP login required)
- `/#upload`: admin upload page (admin role required)
- `/#share/<token>`: scoped view-only share link for a full delivery or selected files

## Deploy on Vercel

This repo includes `vercel.json` with build/output settings, asset cache headers, and basic security headers.

In Vercel:
1. Import `gvvskvarma/rajugari-abbayi-photos`.
2. Select the `main` branch for production.
3. Add environment variable:
   - `VITE_FORMSPREE_ENDPOINT=https://formspree.io/f/mzdabzwy`
4. Deploy.

## Production release flow

The repo is set up so a push to `main` drives the live stack in three layers:

- Frontend: Vercel production deploy from the linked `main` branch
- API: Cloudflare Worker deploy from GitHub Actions
- Database: Supabase migration deploy from GitHub Actions

Required GitHub Actions secrets:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_ID`
- `SUPABASE_DB_PASSWORD`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The workflow lives in `.github/workflows/deploy-production.yml`.

## Day 2 auth/admin artifacts

- Supabase migration: `supabase/migrations/20260310_day2_auth_roles_admin.sql`
- API contract: `docs/api/day2-auth-admin-contract.md`
- Frontend: role-guarded admin dashboard in `src/App.tsx`

## Day 3 upload pipeline artifacts

- API contract: `docs/api/day3-upload-pipeline-contract.md`
- Worker APIs: `POST /api/v1/request-upload-url` and `POST /api/v1/upload/complete`
- Frontend: admin direct-to-R2 upload flow with retry/progress in `src/App.tsx`
- Historical migration: `supabase/migrations/20260311_day3_upload_pipeline.sql`

## Day 4 delivery/security artifacts

- Supabase migration: `supabase/migrations/20260311_day4_delivery_security.sql`
- API contract: `docs/api/day4-delivery-contract.md`
- Worker APIs:
  - `GET /api/v1/deliveries/:deliveryId/gallery`
  - `POST /api/v1/media/signed-url` (per-file rules + download logging)
  - `GET /api/v1/my-pictures` (private gallery delivery listing)
- Frontend: private gallery + controlled view/download actions in `src/App.tsx`

## Day 5 admin audit artifacts

- Supabase migration: `supabase/migrations/20260313_admin_activity.sql`
- Worker APIs:
  - `GET /api/v1/admin/activity`
  - `POST /api/v1/admin/activity`
- Frontend: worker-backed admin activity feed in `src/App.tsx`

## Day 5 hardening/release artifacts

- Runbook: `docs/runbook/day5-mvp-runbook.md`
- Validation report: `docs/validation/day5-e2e-validation.md`
- Worker hardening:
  - per-route rate-limit caps + in-memory cleanup
  - stricter CORS origin resolution
  - global API error middleware
- Frontend hardening:
  - API request timeout and clearer network/timeout error messages

## Day 5 share-link scope artifacts

- Supabase migration: `supabase/migrations/20260331_share_link_scopes.sql`
- API contract updates: `docs/api/day4-delivery-contract.md`
- Frontend: share link composer with `All files` / `Selected files only` scope selection in `src/App.tsx`
