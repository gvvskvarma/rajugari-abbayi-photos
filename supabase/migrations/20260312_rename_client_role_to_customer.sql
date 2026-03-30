-- Normalize the legacy `client` app role to `customer`.
-- Safe to run on databases that already use `customer`.

do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    join pg_enum e on e.enumtypid = t.oid
    where n.nspname = 'public'
      and t.typname = 'app_role'
      and e.enumlabel = 'client'
  ) and not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    join pg_enum e on e.enumtypid = t.oid
    where n.nspname = 'public'
      and t.typname = 'app_role'
      and e.enumlabel = 'customer'
  ) then
    alter type public.app_role rename value 'client' to 'customer';
  end if;
end
$$;
