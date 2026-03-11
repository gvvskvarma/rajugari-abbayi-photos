# Week 1 Day 4 API Contract (Client Delivery + Secure Downloads)

Day 4 introduces private gallery retrieval, per-file access controls, expiring signed links, and download logging.

## Access model

- Auth: Supabase JWT (`Authorization: Bearer <token>`) for account-scoped gallery access
- Delivery-level access: `delivery_recipients` + expiry checks
- File-level access: `delivery_assets.can_view` and `delivery_assets.can_download`
- Download logging: every successful `download` signed-url issuance writes `download_events`

## Endpoints

### `GET /api/v1/deliveries/:deliveryId/gallery`

Returns private gallery files for one delivery, filtered by per-file `can_view`.

Response:

```json
{
  "deliveryId": "uuid",
  "accessMode": "owner",
  "assets": [
    {
      "id": "uuid",
      "filename": "IMG_0012.jpg",
      "mime_type": "image/jpeg",
      "bytes": 4812312,
      "canView": true,
      "canDownload": true
    }
  ]
}
```

### `GET /api/v1/my-pictures`

Returns all active recipient deliveries with file-level access flags.

Response:

```json
{
  "deliveries": [
    {
      "deliveryId": "uuid",
      "accessMode": "viewer",
      "expiresAt": "2026-03-20T12:00:00Z",
      "assets": [
        {
          "id": "uuid",
          "filename": "preview.jpg",
          "mime_type": "image/jpeg",
          "bytes": 801231,
          "canView": true,
          "canDownload": false
        }
      ]
    }
  ]
}
```

### `POST /api/v1/media/signed-url`

Now enforces:
- delivery recipient expiry
- per-file `can_view` / `can_download`
- share token rules for shared access

On `mode=download`, the API logs a `download_events` record with:
- `delivery_id`
- `asset_id`
- `requester_profile_id` (nullable for share links)
- hashed requester IP
- user agent

## Persistence updates

Migration: `supabase/migrations/20260311_day4_delivery_security.sql`

Adds:
- `assets.delivery_id` (if missing)
- `delivery_assets.can_view` + `delivery_assets.can_download`
- backfill from `assets.delivery_id` into `delivery_assets`
- supporting indexes
