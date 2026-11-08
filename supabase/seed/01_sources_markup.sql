-- Seed: the 22 contract sources and the global markup rule.
-- Idempotent: safe to re-run.
--
-- config holds PLACEHOLDERS only: no secrets, ever. Credentials come from the
-- env vars named in "env" (see .env.example). "mode": "mock" means the
-- catalog service uses local fixtures until those env vars are set.
-- Re-running this seed never overwrites a config that has been edited.

insert into sources (kind, code, name, is_active, config) values
  -- Dropship suppliers (markup applies)
  ('dropship',  'cj',             'CJ Dropshipping',          true,
     '{"placeholder": true, "mode": "mock", "env": ["CJ_API_KEY"]}'),
  ('dropship',  'aliexpress_ds',  'AliExpress Dropshipping',  true,
     '{"placeholder": true, "mode": "mock", "env": ["ALIEXPRESS_DS_APP_KEY", "ALIEXPRESS_DS_APP_SECRET"]}'),
  ('dropship',  'spocket',        'Spocket',                  true,
     '{"placeholder": true, "mode": "mock", "env": ["SPOCKET_API_KEY"]}'),
  ('dropship',  'printful',       'Printful',                 true,
     '{"placeholder": true, "mode": "mock", "env": ["PRINTFUL_API_TOKEN"]}'),
  -- Affiliate partners (no markup; customer clicks out)
  ('affiliate', 'amazon',         'Amazon',                   true,
     '{"placeholder": true, "mode": "mock", "api": "creators", "env": ["AMAZON_CREATORS_CREDENTIAL_ID", "AMAZON_CREATORS_CREDENTIAL_SECRET", "AMAZON_PARTNER_TAGS"]}'),
  ('affiliate', 'temu',           'Temu',                     true,
     '{"placeholder": true, "mode": "mock", "env": ["TEMU_AFFILIATE_ID"]}'),
  ('affiliate', 'shein',          'SHEIN',                    true,
     '{"placeholder": true, "mode": "mock", "env": ["SHEIN_AFFILIATE_ID"]}'),
  ('affiliate', 'aliexpress_aff', 'AliExpress',               true,
     '{"placeholder": true, "mode": "mock", "api": "portals", "env": ["ALIEXPRESS_AFF_APP_KEY", "ALIEXPRESS_AFF_TRACKING_ID"]}'),
  ('affiliate', 'jumia',          'Jumia',                    true,
     '{"placeholder": true, "mode": "mock", "env": ["JUMIA_AFFILIATE_ID"], "countries": ["NG", "KE", "EG", "MA", "CI", "GH", "SN", "UG"]}'),
  ('affiliate', 'noon',           'noon',                     true,
     '{"placeholder": true, "mode": "mock", "env": ["NOON_AFFILIATE_ID"], "countries": ["AE", "SA", "EG"]}'),
  ('affiliate', 'flipkart',       'Flipkart',                 true,
     '{"placeholder": true, "mode": "mock", "env": ["FLIPKART_AFFILIATE_ID"], "countries": ["IN"]}'),
  -- Worldwide: eBay (Browse API + eBay Partner Network) and affiliate networks
  ('affiliate', 'ebay',           'eBay',                     true,
     '{"placeholder": true, "mode": "mock", "api": "browse", "env": ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_CAMPAIGN_ID"]}'),
  ('affiliate', 'awin',           'Awin',                     true,
     '{"placeholder": true, "mode": "mock", "network": true, "feeds": true, "env": ["AWIN_PUBLISHER_ID", "AWIN_FEED_KEY"]}'),
  ('affiliate', 'impact',         'Impact',                   true,
     '{"placeholder": true, "mode": "mock", "network": true, "env": ["IMPACT_ACCOUNT_SID", "IMPACT_AUTH_TOKEN"]}'),
  ('affiliate', 'rakuten',        'Rakuten Advertising',      true,
     '{"placeholder": true, "mode": "mock", "network": true, "env": ["RAKUTEN_ADV_TOKEN"]}'),
  ('affiliate', 'admitad',        'Admitad',                  true,
     '{"placeholder": true, "mode": "mock", "network": true, "feeds": true, "env": ["ADMITAD_CLIENT_ID", "ADMITAD_CLIENT_SECRET", "ADMITAD_WEBSITE_ID"]}'),
  ('affiliate', 'cj_affiliate',   'CJ Affiliate',             true,
     '{"placeholder": true, "mode": "mock", "network": true, "env": ["CJ_AFFILIATE_TOKEN", "CJ_AFFILIATE_COMPANY_ID", "CJ_AFFILIATE_WEBSITE_ID"]}'),
  -- Regional leaders where no other source is local
  ('affiliate', 'mercadolibre',   'Mercado Libre',            true,
     '{"placeholder": true, "mode": "mock", "env": ["MERCADOLIBRE_AFFILIATE_ID"], "countries": ["AR", "BR", "MX", "CO", "CL", "PE", "UY", "EC"]}'),
  ('affiliate', 'shopee',         'Shopee',                   true,
     '{"placeholder": true, "mode": "mock", "env": ["SHOPEE_APP_ID", "SHOPEE_SECRET"], "countries": ["MY", "SG", "TH", "VN", "ID", "PH", "BR", "TW"]}'),
  ('affiliate', 'lazada',         'Lazada',                   true,
     '{"placeholder": true, "mode": "mock", "feeds": true, "env": ["LAZADA_FEED_URLS"], "countries": ["MY", "SG", "TH", "VN", "ID", "PH"]}'),
  ('affiliate', 'rakuten_ichiba', 'Rakuten Ichiba',           true,
     '{"placeholder": true, "mode": "mock", "env": ["RAKUTEN_APP_ID", "RAKUTEN_AFFILIATE_ID"], "countries": ["JP"]}'),
  ('affiliate', 'coupang',        'Coupang',                  true,
     '{"placeholder": true, "mode": "mock", "env": ["COUPANG_ACCESS_KEY", "COUPANG_SECRET_KEY"], "countries": ["KR"]}')
on conflict (code) do update
  set kind = excluded.kind, name = excluded.name;

-- Global markup: 35% + $0, local price rounded up to x.99.
insert into markup_rules (scope, scope_id, percent, fixed_usd, round_to, priority, is_active)
select 'global', null, 35, 0, 0.99, 0, true
where not exists (select 1 from markup_rules where scope = 'global');
