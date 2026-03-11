-- Day 2 auth + roles + admin baseline.
-- Adds profile bootstrapping from auth.users and role-aware admin utilities.

create table if not exists public.admin_allowlist (
  email text primary key,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = uid
      and p.role = 'admin'
  );
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  computed_role public.app_role := 'client';
begin
  if exists (
    select 1
    from public.admin_allowlist a
    where lower(a.email) = lower(new.email)
  ) then
    computed_role := 'admin';
  end if;

  insert into public.profiles (id, role, display_name)
  values (
    new.id,
    computed_role,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id)
  do update set
    role = excluded.role,
    display_name = coalesce(excluded.display_name, public.profiles.display_name),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_auth_user();

-- Promote allowlisted emails to admin when records already exist.
update public.profiles p
set role = 'admin',
    updated_at = now()
from auth.users u
join public.admin_allowlist a on lower(a.email) = lower(u.email)
where p.id = u.id
  and p.role <> 'admin';

-- Refresh owner policies with admin override on core Day 2 entities.
drop policy if exists "clients_owner_all" on public.clients;
create policy "clients_owner_or_admin_all" on public.clients
for all to authenticated
using (owner_user_id = auth.uid() or public.is_admin(auth.uid()))
with check (owner_user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "projects_owner_all" on public.projects;
create policy "projects_owner_or_admin_all" on public.projects
for all to authenticated
using (owner_user_id = auth.uid() or public.is_admin(auth.uid()))
with check (owner_user_id = auth.uid() or public.is_admin(auth.uid()));
