-- Day 1 architecture baseline for the photography delivery platform.
-- Entities: users (profiles), clients, projects, galleries, assets, deliveries, downloads.

create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'client');
create type public.project_status as enum ('draft', 'active', 'completed', 'archived');
create type public.delivery_status as enum ('draft', 'shared', 'expired', 'revoked');
create type public.asset_kind as enum ('photo', 'video', 'document', 'other');

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'client',
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete restrict,
  full_name text not null,
  email text not null,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (email)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  description text,
  shoot_date date,
  location text,
  status public.project_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.galleries (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text,
  is_public_preview boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete cascade,
  gallery_id uuid references public.galleries(id) on delete set null,
  kind public.asset_kind not null default 'photo',
  filename text not null,
  mime_type text not null,
  bytes bigint not null check (bytes > 0),
  width integer check (width > 0),
  height integer check (height > 0),
  duration_seconds numeric(10,2) check (duration_seconds >= 0),
  r2_object_key text not null unique,
  checksum_sha256 text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete cascade,
  gallery_id uuid references public.galleries(id) on delete set null,
  client_id uuid not null references public.clients(id) on delete cascade,
  status public.delivery_status not null default 'draft',
  access_token text not null unique,
  expires_at timestamptz,
  shared_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.delivery_assets (
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (delivery_id, asset_id)
);

create table if not exists public.download_events (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  requester_profile_id uuid references public.profiles(id) on delete set null,
  ip_hash text,
  user_agent text,
  downloaded_at timestamptz not null default now()
);

create index if not exists clients_owner_idx on public.clients(owner_user_id);
create index if not exists projects_owner_idx on public.projects(owner_user_id);
create index if not exists projects_client_idx on public.projects(client_id);
create index if not exists galleries_project_idx on public.galleries(project_id);
create index if not exists assets_project_idx on public.assets(project_id);
create index if not exists assets_gallery_idx on public.assets(gallery_id);
create index if not exists deliveries_project_idx on public.deliveries(project_id);
create index if not exists deliveries_client_idx on public.deliveries(client_id);
create index if not exists deliveries_token_idx on public.deliveries(access_token);
create index if not exists download_events_delivery_idx on public.download_events(delivery_id);
create index if not exists download_events_asset_idx on public.download_events(asset_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
before update on public.clients
for each row execute procedure public.set_updated_at();

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
before update on public.projects
for each row execute procedure public.set_updated_at();

drop trigger if exists galleries_set_updated_at on public.galleries;
create trigger galleries_set_updated_at
before update on public.galleries
for each row execute procedure public.set_updated_at();

drop trigger if exists assets_set_updated_at on public.assets;
create trigger assets_set_updated_at
before update on public.assets
for each row execute procedure public.set_updated_at();

drop trigger if exists deliveries_set_updated_at on public.deliveries;
create trigger deliveries_set_updated_at
before update on public.deliveries
for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.projects enable row level security;
alter table public.galleries enable row level security;
alter table public.assets enable row level security;
alter table public.deliveries enable row level security;
alter table public.delivery_assets enable row level security;
alter table public.download_events enable row level security;

-- Day 1 baseline policies:
-- - authenticated users can read/write rows they own
-- - admin override can be added on Day 2 with role-aware policies
create policy "profiles_self_select" on public.profiles
for select to authenticated
using (auth.uid() = id);

create policy "profiles_self_update" on public.profiles
for update to authenticated
using (auth.uid() = id);

create policy "clients_owner_all" on public.clients
for all to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

create policy "projects_owner_all" on public.projects
for all to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

create policy "galleries_owner_all" on public.galleries
for all to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

create policy "assets_owner_all" on public.assets
for all to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

create policy "deliveries_owner_all" on public.deliveries
for all to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

create policy "delivery_assets_owner_all" on public.delivery_assets
for all to authenticated
using (
  exists (
    select 1
    from public.deliveries d
    where d.id = delivery_id
      and d.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.deliveries d
    where d.id = delivery_id
      and d.owner_user_id = auth.uid()
  )
);

create policy "download_events_owner_read_insert" on public.download_events
for select to authenticated
using (
  exists (
    select 1
    from public.deliveries d
    where d.id = delivery_id
      and d.owner_user_id = auth.uid()
  )
);

create policy "download_events_owner_insert" on public.download_events
for insert to authenticated
with check (
  exists (
    select 1
    from public.deliveries d
    where d.id = delivery_id
      and d.owner_user_id = auth.uid()
  )
);
