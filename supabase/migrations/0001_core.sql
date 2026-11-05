-- Zakka core schema. Authoritative: later migrations may add, never rename or drop.

create extension if not exists pgcrypto;
create extension if not exists vector;

-- Reference data ------------------------------------------------------------

create table currencies (
  code      char(3) primary key,
  symbol    text not null,
  decimals  smallint not null default 2
);

create table locales (
  code       text primary key,
  name       text not null,
  dir        text not null default 'ltr' check (dir in ('ltr', 'rtl')),
  is_active  boolean not null default true
);

create table countries (
  code            char(2) primary key,
  name            text not null,
  currency        char(3) not null references currencies(code),
  default_locale  text not null references locales(code),
  is_active       boolean not null default true
);

create table fx_rates (
  base        char(3) not null default 'USD' references currencies(code),
  quote       char(3) not null references currencies(code),
  rate        numeric(18, 8) not null check (rate > 0),
  fetched_at  timestamptz not null default now(),
  primary key (base, quote)
);

-- Catalog -------------------------------------------------------------------

create table categories (
  id                   uuid primary key default gen_random_uuid(),
  parent_id            uuid references categories(id) on delete cascade,
  slug                 text not null unique,
  shopify_taxonomy_id  text,
  google_category_id   integer,
  sort                 integer not null default 0,
  is_top_level         boolean not null default false,
  icon                 text
);

create table category_translations (
  category_id  uuid not null references categories(id) on delete cascade,
  locale       text not null references locales(code),
  name         text not null,
  primary key (category_id, locale)
);

create table sources (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('dropship', 'affiliate')),
  code       text not null unique,
  name       text not null,
  is_active  boolean not null default true,
  config     jsonb not null default '{}'::jsonb
);

create table products (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid references categories(id),
  brand         text,
  gtin          text,
  image_urls    text[] not null default '{}',
  attributes    jsonb not null default '{}'::jsonb,
  rating        numeric(3, 2),
  review_count  integer not null default 0,
  embedding     vector(1024),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table product_translations (
  product_id     uuid not null references products(id) on delete cascade,
  locale         text not null references locales(code),
  title          text not null,
  description    text,
  bullet_points  text[] not null default '{}',
  primary key (product_id, locale)
);

create table offers (
  id                 uuid primary key default gen_random_uuid(),
  product_id         uuid not null references products(id) on delete cascade,
  source_id          uuid not null references sources(id),
  external_id        text not null,
  url                text,
  cost_usd           numeric(12, 2),
  list_price_usd     numeric(12, 2),
  shipping_usd       numeric(12, 2) not null default 0,
  stock              integer,
  ships_from         char(2),
  ships_to           text[] not null default '{}',
  delivery_days_min  smallint,
  delivery_days_max  smallint,
  commission_rate    numeric(5, 4),
  last_synced_at     timestamptz,
  is_active          boolean not null default true,
  unique (source_id, external_id)
);

create table markup_rules (
  id         uuid primary key default gen_random_uuid(),
  scope      text not null check (scope in ('global', 'category', 'source', 'product')),
  scope_id   uuid,
  percent    numeric(6, 2) not null default 0,
  fixed_usd  numeric(10, 2) not null default 0,
  round_to   numeric(6, 2) not null default 0.99,
  priority   integer not null default 0,
  is_active  boolean not null default true,
  check ((scope = 'global') = (scope_id is null))
);

-- Customers and orders ------------------------------------------------------

create table customers (
  id                   uuid primary key default gen_random_uuid(),
  auth_user_id         uuid unique,
  phone_e164           text unique,
  email                text unique,
  locale               text references locales(code),
  country_code         char(2) references countries(code),
  whatsapp_opt_in      boolean not null default false,
  whatsapp_opt_in_at   timestamptz,
  marketing_opt_in     boolean not null default false,
  created_at           timestamptz not null default now()
);

create table orders (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid references customers(id),
  status            text not null default 'pending_payment' check (status in
                      ('pending_payment', 'paid', 'forwarded', 'shipped', 'delivered', 'cancelled', 'refunded')),
  currency          char(3) not null references currencies(code),
  subtotal          numeric(12, 2) not null,
  shipping          numeric(12, 2) not null default 0,
  tax               numeric(12, 2) not null default 0,
  total             numeric(12, 2) not null,
  total_usd         numeric(12, 2) not null,
  payment_provider  text,
  payment_ref       text,
  channel           text not null default 'web' check (channel in ('web', 'whatsapp')),
  created_at        timestamptz not null default now()
);

create table order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references orders(id) on delete cascade,
  offer_id       uuid not null references offers(id),
  product_id     uuid not null references products(id),
  qty            integer not null check (qty > 0),
  unit_price     numeric(12, 2) not null,
  unit_cost_usd  numeric(12, 2)
);

create table supplier_orders (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references orders(id) on delete cascade,
  source_id          uuid not null references sources(id),
  external_order_id  text,
  status             text not null default 'pending',
  cost_usd           numeric(12, 2),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table shipments (
  id                 uuid primary key default gen_random_uuid(),
  supplier_order_id  uuid not null references supplier_orders(id) on delete cascade,
  carrier            text,
  tracking_number    text,
  tracking_url       text,
  status             text,
  last_event         text,
  updated_at         timestamptz not null default now()
);

create table affiliate_clicks (
  id            bigserial primary key,
  customer_id   uuid references customers(id),
  offer_id      uuid not null references offers(id),
  country_code  char(2),
  locale        text,
  channel       text not null default 'web',
  clicked_at    timestamptz not null default now()
);

-- WhatsApp ------------------------------------------------------------------

create table whatsapp_conversations (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid references customers(id),
  wa_id             text not null unique,
  state             text not null default 'idle',
  context           jsonb not null default '{}'::jsonb,
  last_inbound_at   timestamptz,
  last_outbound_at  timestamptz
);

create table whatsapp_messages (
  id               bigserial primary key,
  conversation_id  uuid not null references whatsapp_conversations(id) on delete cascade,
  direction        text not null check (direction in ('in', 'out')),
  type             text not null,
  body             text,
  template_name    text,
  wa_message_id    text unique,
  created_at       timestamptz not null default now()
);

-- Supplier quality ----------------------------------------------------------

create table supplier_scores (
  source_id          uuid not null references sources(id),
  period_start       date not null,
  orders             integer not null default 0,
  on_time_rate       numeric(5, 4),
  defect_rate        numeric(5, 4),
  avg_delivery_days  numeric(5, 2),
  primary key (source_id, period_start)
);
