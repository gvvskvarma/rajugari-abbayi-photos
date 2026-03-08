-- Day 2-4 foundation: role bootstrap, delivery recipients, share links, and 60-day retention.

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'access_mode' and n.nspname = 'public'
  ) then
    create type public.access_mode as enum ('owner', 'viewer');
  end if;
end
$$;

create table if not exists public.admin_allowlist (
  email text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.delivery_recipients (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  email text not null,
  access_mode public.access_mode not null default 'owner',
  first_viewed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (delivery_id, email)
);

create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  access_mode public.access_mode not null default 'viewer',
  allow_download boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.assets
add column if not exists delivery_id uuid references public.deliveries(id) on delete cascade;

create index if not exists assets_delivery_idx on public.assets(delivery_id);
create index if not exists delivery_recipients_delivery_idx on public.delivery_recipients(delivery_id);
create index if not exists delivery_recipients_email_idx on public.delivery_recipients(lower(email));
create index if not exists share_links_token_idx on public.share_links(token);

create or replace function public.current_user_email()
returns text
language sql
stable
as $$
  select coalesce(lower(auth.jwt() ->> 'email'), '')
$$;

create or replace function public.user_is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
$$;

create or replace function public.ensure_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, display_name)
  values (
    new.id,
    case
      when exists (
        select 1
        from public.admin_allowlist a
        where lower(a.email) = lower(new.email)
      ) then 'admin'::public.app_role
      else 'client'::public.app_role
    end,
    split_part(coalesce(new.email, ''), '@', 1)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_ensure_profile on auth.users;
create trigger on_auth_user_created_ensure_profile
after insert on auth.users
for each row execute function public.ensure_profile_for_auth_user();

create or replace function public.activate_delivery_retention(recipient_row_id uuid)
returns public.delivery_recipients
language plpgsql
security definer
set search_path = public
as $$
declare
  target_row public.delivery_recipients;
begin
  update public.delivery_recipients
  set
    first_viewed_at = coalesce(first_viewed_at, now()),
    expires_at = coalesce(expires_at, now() + interval '60 days')
  where id = recipient_row_id
    and lower(email) = public.current_user_email()
  returning * into target_row;

  return target_row;
end;
$$;

alter table public.delivery_recipients enable row level security;
alter table public.share_links enable row level security;

drop policy if exists delivery_recipients_admin_or_owner_select on public.delivery_recipients;
create policy delivery_recipients_admin_or_owner_select on public.delivery_recipients
for select to authenticated
using (
  public.user_is_admin()
  or lower(email) = public.current_user_email()
  or exists (
    select 1
    from public.deliveries d
    where d.id = delivery_id
      and d.owner_user_id = auth.uid()
  )
);

drop policy if exists delivery_recipients_admin_insert on public.delivery_recipients;
create policy delivery_recipients_admin_insert on public.delivery_recipients
for insert to authenticated
with check (
  public.user_is_admin()
  or exists (
    select 1
    from public.deliveries d
    where d.id = delivery_id
      and d.owner_user_id = auth.uid()
  )
);

drop policy if exists share_links_owner_select on public.share_links;
create policy share_links_owner_select on public.share_links
for select to authenticated
using (
  owner_profile_id = auth.uid()
  or exists (
    select 1
    from public.delivery_recipients dr
    where dr.delivery_id = share_links.delivery_id
      and lower(dr.email) = public.current_user_email()
  )
);

drop policy if exists share_links_owner_insert on public.share_links;
create policy share_links_owner_insert on public.share_links
for insert to authenticated
with check (
  owner_profile_id = auth.uid()
  and (
    public.user_is_admin()
    or exists (
      select 1
      from public.delivery_recipients dr
      where dr.delivery_id = share_links.delivery_id
        and lower(dr.email) = public.current_user_email()
    )
  )
);
