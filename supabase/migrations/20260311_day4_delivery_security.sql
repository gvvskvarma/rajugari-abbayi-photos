-- Day 4: secure client delivery controls
-- Adds explicit asset->delivery linkage and per-file view/download rules.

alter table public.assets
  add column if not exists delivery_id uuid references public.deliveries(id) on delete set null;

create index if not exists assets_delivery_idx on public.assets(delivery_id);

alter table public.delivery_assets
  add column if not exists can_view boolean not null default true,
  add column if not exists can_download boolean not null default true;

-- Backfill bridge rows for assets already tied to a delivery.
insert into public.delivery_assets (delivery_id, asset_id, can_view, can_download)
select a.delivery_id, a.id, true, true
from public.assets a
where a.delivery_id is not null
on conflict (delivery_id, asset_id) do update
set can_view = excluded.can_view,
    can_download = excluded.can_download;

create index if not exists delivery_assets_delivery_idx on public.delivery_assets(delivery_id);
create index if not exists delivery_assets_asset_idx on public.delivery_assets(asset_id);
