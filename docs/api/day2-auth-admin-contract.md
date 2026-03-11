# Week 1 Day 2 API Contract (Auth + Roles + Admin Base)

Day 2 extends the Day 1 contract with login context, role guard behavior, and admin CRUD baselines.

## Auth model

- Identity: Supabase Auth session JWT (`Authorization: Bearer <token>`)
- Profile source: `public.profiles`
- Role mapping in API: `admin` or `customer`
- Access rule: `/api/v1/admin/*` requires `admin`

## New/confirmed endpoints

### `GET /api/v1/me`

Returns current auth + role context.

```json
{
  "id": "uuid",
  "email": "admin@example.com",
  "role": "admin",
  "displayName": "Admin"
}
```

### Admin Clients CRUD

- `GET /api/v1/admin/clients`
- `POST /api/v1/admin/clients`
- `PATCH /api/v1/admin/clients/:clientId`
- `DELETE /api/v1/admin/clients/:clientId`

Create body:

```json
{
  "fullName": "Jane Client",
  "email": "jane@example.com",
  "phone": "+1-555-0100",
  "notes": "Wedding package"
}
```

### Admin Projects CRUD

- `GET /api/v1/admin/projects?clientId=<uuid>`
- `POST /api/v1/admin/projects`
- `PATCH /api/v1/admin/projects/:projectId`
- `DELETE /api/v1/admin/projects/:projectId`

Create body:

```json
{
  "clientId": "uuid",
  "name": "Spring Engagement Shoot",
  "description": "Golden hour outdoors",
  "shootDate": "2026-03-20",
  "location": "Dallas, TX",
  "status": "draft"
}
```

## Role/DB updates

- New migration: `supabase/migrations/20260310_day2_auth_roles_admin.sql`
- Adds `admin_allowlist` table for deterministic admin bootstrap.
- Adds `handle_new_auth_user` trigger to auto-create/upsert profile entries.
- Adds helper function `public.is_admin(uid)` and updates core RLS policies with admin override.
