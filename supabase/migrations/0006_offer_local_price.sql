-- Keep a partner's original local-currency price so affiliate prices display exactly (no USD round-trip drift).

alter table offers add column if not exists list_price_local numeric(14, 2);
alter table offers add column if not exists list_currency char(3) references currencies(code);
alter table offers add column if not exists shipping_local numeric(14, 2);

comment on column offers.list_price_local is
  'Partner price in its own currency (list_currency). When the shopper''s currency matches, show this exactly.';

comment on column offers.shipping_local is
  'Partner shipping in list_currency.';

grant select (list_price_local, list_currency, shipping_local) on offers to anon, authenticated;
