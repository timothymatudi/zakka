-- 0002: indexes for hot paths, Row Level Security, updated_at triggers.
-- Adds only. Nothing from 0001_core.sql is renamed or dropped.
--
-- Access model
--   * service_role (catalog, search indexer, concierge, server-side web code)
--     bypasses RLS in Supabase and keeps full access.
--   * anon + authenticated get read access to active reference/catalog data.
--   * authenticated customers can read/update their own `customers` row and
--     read their own orders, order_items, supplier_orders and shipments.
--   * Everything else has RLS enabled with no policy, i.e. service-role only.
--   * Cost/margin columns (offers.cost_usd, offers.commission_rate,
--     order_items.unit_cost_usd, supplier_orders.cost_usd and
--     supplier_orders.external_order_id) are hidden from anon/authenticated
--     with column-level grants. Clients must list columns explicitly
--     instead of `select *` on those three tables.

-- ---------------------------------------------------------------------------
-- Plain-Postgres compatibility shim.
-- On Supabase the roles and auth.uid() already exist and this block is a
-- no-op. On a bare Postgres (CI, local psql) it creates minimal stand-ins so
-- the policies below compile. It never replaces an existing auth.uid().
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    create schema auth;
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    execute $f$
      create function auth.uid() returns uuid
      language sql stable
      as $body$
        select nullif(
          coalesce(
            current_setting('request.jwt.claim.sub', true),
            (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
          ),
          ''
        )::uuid
      $body$
    $f$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Reference / catalog
create index if not exists countries_currency_idx            on countries (currency);
create index if not exists fx_rates_quote_idx                on fx_rates (quote);
create index if not exists categories_parent_idx             on categories (parent_id, sort);
create index if not exists categories_top_level_idx          on categories (sort) where is_top_level;
create index if not exists categories_shopify_taxonomy_idx   on categories (shopify_taxonomy_id) where shopify_taxonomy_id is not null;
create index if not exists category_translations_locale_idx  on category_translations (locale, category_id);
create index if not exists products_category_idx             on products (category_id) where is_active;
create index if not exists products_gtin_idx                 on products (gtin) where gtin is not null;
create index if not exists products_updated_at_idx           on products (updated_at);
create index if not exists product_translations_locale_idx   on product_translations (locale, product_id);

-- Offers: by product, by source, by destination country
create index if not exists offers_product_idx                on offers (product_id);
create index if not exists offers_product_active_idx         on offers (product_id) where is_active;
create index if not exists offers_source_idx                 on offers (source_id, is_active);
create index if not exists offers_ships_to_gin_idx           on offers using gin (ships_to);
create index if not exists offers_last_synced_idx            on offers (source_id, last_synced_at);

-- Pricing lookups
create index if not exists markup_rules_scope_idx            on markup_rules (scope, scope_id, priority desc) where is_active;

-- Customers / orders
create index if not exists customers_country_idx             on customers (country_code);
create index if not exists orders_customer_idx               on orders (customer_id, created_at desc);
create index if not exists orders_status_idx                 on orders (status, created_at desc);
create index if not exists orders_payment_ref_idx            on orders (payment_provider, payment_ref) where payment_ref is not null;
create index if not exists order_items_order_idx             on order_items (order_id);
create index if not exists order_items_offer_idx             on order_items (offer_id);
create index if not exists order_items_product_idx           on order_items (product_id);
create index if not exists supplier_orders_order_idx         on supplier_orders (order_id);
create index if not exists supplier_orders_source_status_idx on supplier_orders (source_id, status);
create index if not exists supplier_orders_external_idx      on supplier_orders (source_id, external_order_id) where external_order_id is not null;
create index if not exists shipments_supplier_order_idx      on shipments (supplier_order_id);
create index if not exists shipments_tracking_idx            on shipments (tracking_number) where tracking_number is not null;

-- Affiliate clicks
create index if not exists affiliate_clicks_offer_time_idx   on affiliate_clicks (offer_id, clicked_at desc);
create index if not exists affiliate_clicks_time_idx         on affiliate_clicks (clicked_at desc);
create index if not exists affiliate_clicks_customer_idx     on affiliate_clicks (customer_id) where customer_id is not null;

-- WhatsApp (wa_id and wa_message_id are already unique-indexed in 0001)
create index if not exists whatsapp_conversations_customer_idx on whatsapp_conversations (customer_id);
create index if not exists whatsapp_conversations_inbound_idx  on whatsapp_conversations (last_inbound_at desc);
create index if not exists whatsapp_messages_conversation_idx  on whatsapp_messages (conversation_id, created_at desc);

-- Supplier quality
create index if not exists supplier_scores_period_idx        on supplier_scores (period_start desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on products;
create trigger products_set_updated_at
  before update on products
  for each row execute function public.set_updated_at();

drop trigger if exists supplier_orders_set_updated_at on supplier_orders;
create trigger supplier_orders_set_updated_at
  before update on supplier_orders
  for each row execute function public.set_updated_at();

drop trigger if exists shipments_set_updated_at on shipments;
create trigger shipments_set_updated_at
  before update on shipments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: enable on every table
-- ---------------------------------------------------------------------------

alter table currencies              enable row level security;
alter table locales                 enable row level security;
alter table countries               enable row level security;
alter table fx_rates                enable row level security;
alter table categories              enable row level security;
alter table category_translations   enable row level security;
alter table sources                 enable row level security;
alter table products                enable row level security;
alter table product_translations    enable row level security;
alter table offers                  enable row level security;
alter table markup_rules            enable row level security;
alter table customers               enable row level security;
alter table orders                  enable row level security;
alter table order_items             enable row level security;
alter table supplier_orders         enable row level security;
alter table shipments               enable row level security;
alter table affiliate_clicks        enable row level security;
alter table whatsapp_conversations  enable row level security;
alter table whatsapp_messages       enable row level security;
alter table supplier_scores         enable row level security;

-- ---------------------------------------------------------------------------
-- Table privileges
-- Supabase grants ALL on public tables to anon/authenticated by default and
-- relies on RLS. We tighten that: start from nothing, then grant only what
-- the policies below are meant to allow. service_role keeps everything.
-- ---------------------------------------------------------------------------

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Public reference/catalog reads
grant select on currencies, locales, countries, fx_rates,
                categories, category_translations,
                products, product_translations
  to anon, authenticated;

-- offers: everything except supplier cost and commission
grant select (id, product_id, source_id, external_id, url, list_price_usd,
              shipping_usd, stock, ships_from, ships_to, delivery_days_min,
              delivery_days_max, last_synced_at, is_active)
  on offers to anon, authenticated;

-- customers: read own row; update only self-service columns
grant select on customers to authenticated;
grant update (locale, country_code, whatsapp_opt_in, whatsapp_opt_in_at, marketing_opt_in)
  on customers to authenticated;

-- own orders (read only)
grant select on orders to authenticated;
grant select (id, order_id, offer_id, product_id, qty, unit_price)
  on order_items to authenticated;
grant select (id, order_id, source_id, status, created_at, updated_at)
  on supplier_orders to authenticated;
grant select on shipments to authenticated;

-- ---------------------------------------------------------------------------
-- Policies: public catalog
-- ---------------------------------------------------------------------------

drop policy if exists currencies_public_read on currencies;
create policy currencies_public_read on currencies
  for select to anon, authenticated using (true);

drop policy if exists locales_public_read on locales;
create policy locales_public_read on locales
  for select to anon, authenticated using (is_active);

drop policy if exists countries_public_read on countries;
create policy countries_public_read on countries
  for select to anon, authenticated using (is_active);

drop policy if exists fx_rates_public_read on fx_rates;
create policy fx_rates_public_read on fx_rates
  for select to anon, authenticated using (true);

drop policy if exists categories_public_read on categories;
create policy categories_public_read on categories
  for select to anon, authenticated using (true);

drop policy if exists category_translations_public_read on category_translations;
create policy category_translations_public_read on category_translations
  for select to anon, authenticated using (true);

drop policy if exists products_public_read on products;
create policy products_public_read on products
  for select to anon, authenticated using (is_active);

drop policy if exists product_translations_public_read on product_translations;
create policy product_translations_public_read on product_translations
  for select to anon, authenticated
  using (exists (select 1 from products p where p.id = product_translations.product_id and p.is_active));

drop policy if exists offers_public_read on offers;
create policy offers_public_read on offers
  for select to anon, authenticated using (is_active);

-- sources: no client policy. Raw table (with config) is service-role only.
-- Clients read the `public_sources` view below.

create or replace view public_sources as
  select id, kind, code, name, is_active
  from sources
  where is_active;
-- Deliberately NOT security_invoker: the view runs with its owner's rights so
-- it can read `sources` past RLS, but it never exposes `config`.
comment on view public_sources is
  'Active sources without the config column. Safe for anon/authenticated.';
revoke all on public_sources from anon, authenticated;
grant select on public_sources to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Policies: customer-owned rows
-- (select auth.uid()) is wrapped so Postgres evaluates it once per statement.
-- ---------------------------------------------------------------------------

drop policy if exists customers_select_own on customers;
create policy customers_select_own on customers
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

drop policy if exists customers_update_own on customers;
create policy customers_update_own on customers
  for update to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

drop policy if exists orders_select_own on orders;
create policy orders_select_own on orders
  for select to authenticated
  using (exists (
    select 1 from customers c
    where c.id = orders.customer_id
      and c.auth_user_id = (select auth.uid())
  ));

drop policy if exists order_items_select_own on order_items;
create policy order_items_select_own on order_items
  for select to authenticated
  using (exists (
    select 1 from orders o
    join customers c on c.id = o.customer_id
    where o.id = order_items.order_id
      and c.auth_user_id = (select auth.uid())
  ));

drop policy if exists supplier_orders_select_own on supplier_orders;
create policy supplier_orders_select_own on supplier_orders
  for select to authenticated
  using (exists (
    select 1 from orders o
    join customers c on c.id = o.customer_id
    where o.id = supplier_orders.order_id
      and c.auth_user_id = (select auth.uid())
  ));

drop policy if exists shipments_select_own on shipments;
create policy shipments_select_own on shipments
  for select to authenticated
  using (exists (
    select 1 from supplier_orders so
    join orders o    on o.id = so.order_id
    join customers c on c.id = o.customer_id
    where so.id = shipments.supplier_order_id
      and c.auth_user_id = (select auth.uid())
  ));

-- markup_rules, affiliate_clicks, whatsapp_conversations, whatsapp_messages,
-- supplier_scores, sources: RLS enabled, no policies => service-role only.
