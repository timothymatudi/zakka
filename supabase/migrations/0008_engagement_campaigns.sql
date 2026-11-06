-- Engagement signals and campaigns for refresh tiering; separate sync bookkeeping from product attributes.

alter table offers add column if not exists last_engaged_at timestamptz;
alter table offers add column if not exists campaign_until timestamptz;
alter table products add column if not exists last_impression_at timestamptz;
alter table products add column if not exists sync_meta jsonb not null default '{}'::jsonb;

create index if not exists offers_engaged_idx on offers (last_engaged_at) where is_active;
create index if not exists offers_campaign_idx on offers (campaign_until) where campaign_until is not null;
create index if not exists products_impression_idx on products (last_impression_at);

comment on column offers.campaign_until is 'Offer is part of an active marketing campaign until this time (treated as hot tier).';
comment on column products.sync_meta is 'Catalog sync bookkeeping (detail fetched, mirrored images, text hash). Internal.';
