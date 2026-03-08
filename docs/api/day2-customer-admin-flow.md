# Day 2-4 Flow Contract: Email OTP + Role Routing + Delivery Access

## Auth

- Single flow: email OTP for both login and registration.
- No role selector in UI.
- Role is assigned server-side:
  - default signup role = `customer` (stored as `client` in DB enum)
  - allowlisted emails auto-promote to `admin` at profile bootstrap.

## Navigation

- Logged out: default nav.
- Logged in customer: add `My Pictures`.
- Logged in admin: add `Upload`.

## Upload (Admin)

1. Admin enters client email.
2. Create or reuse client record.
3. Create project + delivery.
4. Create `delivery_recipients` mapping with `access_mode='owner'`.
5. Persist asset metadata rows.
6. Provide client link to `/#my-pictures`.

## My Pictures (Customer)

- Query `delivery_recipients` by authenticated email.
- First load triggers retention activation:
  - set `first_viewed_at` if null.
  - set `expires_at = first_viewed_at + 60 days`.
- Only active deliveries are listed.
- Show countdown: `Expires in X days`.

## General Share Links

- Customer can create `share_links` with:
  - `access_mode='viewer'`
  - `allow_download=false`
  - explicit `expires_at`.
- View-only links must never return downloadable URLs.

## Enforcement Requirements

- Backend must enforce:
  - role-based access (`admin` vs customer owner),
  - 60-day delivery expiration,
  - no-download policy for view-only links,
  - signed URL issuance with short TTL.
