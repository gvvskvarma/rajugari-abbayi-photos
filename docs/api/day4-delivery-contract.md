# Week 1 Day 4 API Contract (Client Delivery + Secure Downloads)

Day 4 introduces private gallery retrieval, per-file access controls, expiring signed links, and download logging.

## Access model

- Auth: Supabase JWT (`Authorization: Bearer <token>`) for account-scoped gallery access
- Delivery-level access: `delivery_recipients` + expiry checks
- File-level access: the worker now derives visibility from `delivery_assets` membership, `share_links.scope_type`, and delivery access. Older deployments may still use `can_view` / `can_download`, but the live upload flow no longer depends on those columns.
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

### `GET /api/v1/share-links/:token/gallery`

Returns the scoped gallery for a share token.

Response includes:
- `deliveryId`
- `scopeType` (`all` or `selected`)
- `allowDownload`
- `expiresAt`
- `assets`

### `POST /api/v1/media/signed-url`

Now enforces:
- delivery recipient expiry
- per-file `can_view` / `can_download`
- share token rules for shared access

### `POST /api/v1/share-links`

Creates a full-delivery share link or a selected-files share link.

Request body:
- `deliveryId`
- `scope`: `all` or `selected`
- `assetIds`: required when `scope` is `selected`
- `expiresInDays`

Response includes:
- `token`
- `url`
- `scopeType`
- `expiresAt`

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
- `delivery_assets` membership rows for asset-to-delivery linkage
- `share_links.scope_type`
- `share_link_assets` membership rows for selected-file share links
- backfill from `assets.delivery_id` into `delivery_assets`
- supporting indexes

Compatibility note:
- Live deployments without `delivery_assets.can_view` or `delivery_assets.can_download` still work; the API derives `canView` and `canDownload` from delivery access until those columns are added later.
