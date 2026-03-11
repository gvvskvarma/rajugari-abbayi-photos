-- Day 3 upload pipeline hardening: upload session tracking for browser->R2 direct uploads.

create table if not exists public.upload_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  upload_token text not null unique,
  original_filename text not null,
  mime_type text not null,
  expected_bytes bigint not null check (expected_bytes > 0),
  r2_object_key text not null unique,
  status text not null default 'requested' check (status in ('requested', 'uploaded', 'finalized', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists upload_sessions_owner_idx on public.upload_sessions(owner_user_id, created_at desc);
create index if not exists upload_sessions_delivery_idx on public.upload_sessions(delivery_id, status);
create index if not exists upload_sessions_expires_idx on public.upload_sessions(expires_at);

drop trigger if exists upload_sessions_set_updated_at on public.upload_sessions;
create trigger upload_sessions_set_updated_at
before update on public.upload_sessions
for each row execute procedure public.set_updated_at();

alter table public.upload_sessions enable row level security;

create policy "upload_sessions_owner_or_admin_all" on public.upload_sessions
for all to authenticated
using (owner_user_id = auth.uid() or public.is_admin(auth.uid()))
with check (owner_user_id = auth.uid() or public.is_admin(auth.uid()));
