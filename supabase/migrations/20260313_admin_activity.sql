-- Day 5 admin activity audit trail for cross-device/session history.

create table if not exists public.admin_activity_events (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  actor_profile_id uuid,
  kind text not null check (kind in ('upload', 'download', 'delete', 'edit', 'create')),
  title text not null,
  detail text not null,
  client_id uuid,
  project_id uuid,
  asset_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_activity_events_owner_created_idx
  on public.admin_activity_events(owner_user_id, created_at desc);
create index if not exists admin_activity_events_client_created_idx
  on public.admin_activity_events(client_id, created_at desc);
create index if not exists admin_activity_events_project_created_idx
  on public.admin_activity_events(project_id, created_at desc);

alter table public.admin_activity_events enable row level security;

create policy "admin_activity_owner_select" on public.admin_activity_events
for select to authenticated
using (
  owner_user_id = auth.uid()
  or public.is_admin(auth.uid())
);

create policy "admin_activity_owner_insert" on public.admin_activity_events
for insert to authenticated
with check (
  owner_user_id = auth.uid()
  and (actor_profile_id = auth.uid() or actor_profile_id is null)
);
