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
- `/#share/<token>`: view-only share link

## Deploy on Vercel

This repo includes `vercel.json` with build/output settings, asset cache headers, and basic security headers.

In Vercel:
1. Import `gvvskvarma/rajugari-abbayi-photos`.
2. Select the `main` branch for production.
3. Add environment variable:
   - `VITE_FORMSPREE_ENDPOINT=https://formspree.io/f/mzdabzwy`
4. Deploy.
