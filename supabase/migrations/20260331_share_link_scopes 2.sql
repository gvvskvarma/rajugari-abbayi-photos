-- Day 5: selected-files share links
-- Allows a share token to represent either a full delivery or a selected file subset.

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'share_scope' and n.nspname = 'public'
  ) then
    create type public.share_scope as enum ('all', 'selected');
  end if;
end
$$;

alter table public.share_links
  add column if not exists scope_type public.share_scope not null default 'all';

create table if not exists public.share_link_assets (
  share_link_id uuid not null references public.share_links(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (share_link_id, asset_id)
);

create index if not exists share_link_assets_share_link_idx on public.share_link_assets(share_link_id);
create index if not exists share_link_assets_asset_idx on public.share_link_assets(asset_id);
