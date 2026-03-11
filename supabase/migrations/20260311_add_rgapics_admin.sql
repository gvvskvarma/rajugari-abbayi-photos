-- Promote rgapics@gmail.com to admin access.

insert into public.admin_allowlist (email)
values ('rgapics@gmail.com')
on conflict (email) do nothing;

update public.profiles
set role = 'admin'::public.app_role
where id in (
  select u.id
  from auth.users u
  where lower(u.email) = 'rgapics@gmail.com'
);
