-- Catalog-computed display price on offers, and shipping addresses on orders.

alter table offers add column if not exists display_price_usd numeric(12, 2);

alter table orders add column if not exists shipping_address jsonb;

comment on column offers.display_price_usd is
  'USD price after markup, written by services/catalog sync. Null for offers not yet priced.';
comment on column orders.shipping_address is
  'Delivery address: {name, phone_e164, line1, line2, city, region, postal_code, country_code}.';
comment on column currencies.decimals is
  'Display decimals, which may be fewer than ISO 4217 (KES, IDR and TZS display as 0).';

-- display_price_usd is public like the rest of offers; shipping_address stays with the owner policy on orders.
grant select (display_price_usd) on offers to anon, authenticated;
