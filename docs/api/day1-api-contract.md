# Week 1 Day 1 API Contract (Cloudflare Workers + Hono)

This contract defines the API shape for the Week 1 MVP architecture.

## Base

- Runtime: Cloudflare Workers
- Framework: Hono
- Base path: `/api/v1`
- Auth: Supabase JWT bearer tokens for authenticated routes
- Response type: `application/json`

## Error envelope

```json
{
  "error": {
    "code": "string",
    "message": "string"
  }
}
```

## Entities

- `profiles` (maps to authenticated users, includes role)
- `clients`
- `projects`
- `galleries`
- `assets`
- `deliveries`
- `download_events`

## Endpoints

### Health

- `GET /api/v1/health`
- Auth: none
- Response:

```json
{
  "ok": true,
  "service": "photography-api",
  "timestamp": "2026-03-05T16:00:00.000Z"
}
```

### Auth profile

- `GET /api/v1/me`
- Auth: required
- Returns current profile (`id`, `role`, `display_name`).

### Clients

- `GET /api/v1/clients`
- Auth: required
- Returns list of owner-scoped clients.

- `POST /api/v1/clients`
- Auth: required
- Body:

```json
{
  "fullName": "A Client",
  "email": "client@example.com",
  "phone": "+1-555-000-0000",
  "notes": "Optional notes"
}
```

- `GET /api/v1/clients/:clientId`
- `PATCH /api/v1/clients/:clientId`
- `DELETE /api/v1/clients/:clientId`
- Auth: required, owner-scoped by RLS.

### Projects

- `GET /api/v1/projects?clientId=&status=`
- `POST /api/v1/projects`
- `GET /api/v1/projects/:projectId`
- `PATCH /api/v1/projects/:projectId`
- `DELETE /api/v1/projects/:projectId`

Create body:

```json
{
  "clientId": "uuid",
  "name": "Engagement shoot",
  "description": "Optional",
  "shootDate": "2026-03-20",
  "location": "Dallas, TX",
  "status": "draft"
}
```

### Galleries

- `GET /api/v1/projects/:projectId/galleries`
- `POST /api/v1/projects/:projectId/galleries`
- `PATCH /api/v1/galleries/:galleryId`
- `DELETE /api/v1/galleries/:galleryId`

Create body:

```json
{
  "title": "Final Selects",
  "description": "Client-ready selection",
  "isPublicPreview": false,
  "sortOrder": 0
}
```

### Assets metadata (Day 1 contract only; upload URL flow on Day 3)

- `GET /api/v1/projects/:projectId/assets`
- `POST /api/v1/projects/:projectId/assets`
- `PATCH /api/v1/assets/:assetId`
- `DELETE /api/v1/assets/:assetId`

Create body:

```json
{
  "galleryId": "uuid",
  "kind": "photo",
  "filename": "IMG_1234.jpg",
  "mimeType": "image/jpeg",
  "bytes": 2384721,
  "width": 4000,
  "height": 6000,
  "durationSeconds": null,
  "r2ObjectKey": "projects/<projectId>/raw/IMG_1234.jpg",
  "checksumSha256": "hex-string",
  "metadata": {
    "camera": "Canon EOS R6"
  }
}
```

### Deliveries

- `GET /api/v1/projects/:projectId/deliveries`
- `POST /api/v1/projects/:projectId/deliveries`
- `PATCH /api/v1/deliveries/:deliveryId`
- `POST /api/v1/deliveries/:deliveryId/assets` (attach list of assets)

Create body:

```json
{
  "clientId": "uuid",
  "galleryId": "uuid",
  "expiresAt": "2026-03-30T00:00:00.000Z"
}
```

### Download events

- `POST /api/v1/deliveries/:deliveryId/download-events`
- Auth: required for admin routes; Day 4 adds token-based client download flow.

Body:

```json
{
  "assetId": "uuid",
  "ipHash": "sha256-truncated",
  "userAgent": "Mozilla/5.0 ..."
}
```

## Non-goals for Day 1

- Signed upload URLs (Day 3)
- Client-facing secure download endpoints (Day 4)
- Rate limits and full hardening (Day 5)
