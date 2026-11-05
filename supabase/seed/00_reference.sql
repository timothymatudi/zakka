-- Seed: reference data (currencies, locales, countries, SAMPLE fx_rates).
-- Idempotent: safe to re-run. Requires migrations 0001-0003.

-- ---------------------------------------------------------------------------
-- Currencies (ISO 4217 code, display symbol, ISO minor units)
-- ---------------------------------------------------------------------------
insert into currencies (code, symbol, decimals) values
  ('USD', '$',      2),
  ('EUR', '€',      2),
  ('GBP', '£',      2),
  ('CHF', 'CHF',    2),
  ('PLN', 'zł',     2),
  ('SEK', 'kr',     2),
  ('NOK', 'kr',     2),
  ('DKK', 'kr.',    2),
  ('TRY', '₺',      2),
  -- Africa
  ('KES', 'KSh',    2),
  ('TZS', 'TSh',    2),
  ('UGX', 'USh',    0),
  ('RWF', 'FRw',    0),
  ('ETB', 'Br',     2),
  ('NGN', '₦',      2),
  ('GHS', 'GH₵',    2),
  ('ZAR', 'R',      2),
  ('EGP', 'E£',     2),
  ('MAD', 'DH',     2),
  ('DZD', 'DA',     2),
  ('TND', 'DT',     3),
  ('XOF', 'CFA',    0),
  ('XAF', 'FCFA',   0),
  ('ZMW', 'ZK',     2),
  ('MZN', 'MT',     2),
  ('AOA', 'Kz',     2),
  -- Middle East
  ('AED', 'د.إ',    2),
  ('SAR', 'ر.س',    2),
  ('QAR', 'ر.ق',    2),
  ('KWD', 'د.ك',    3),
  ('BHD', 'د.ب',    3),
  ('OMR', 'ر.ع.',   3),
  ('JOD', 'د.ا',    3),
  ('IQD', 'ع.د',    3),
  -- Asia
  ('INR', '₹',      2),
  ('PKR', 'Rs',     2),
  ('BDT', '৳',      2),
  ('LKR', 'Rs',     2),
  ('NPR', 'रू',     2),
  ('CNY', '¥',      2),
  ('HKD', 'HK$',    2),
  ('TWD', 'NT$',    2),
  ('SGD', 'S$',     2),
  ('MYR', 'RM',     2),
  ('IDR', 'Rp',     2),
  ('PHP', '₱',      2),
  ('THB', '฿',      2),
  ('VND', '₫',      0),
  ('JPY', '¥',      0),
  ('KRW', '₩',      0),
  -- Americas
  ('CAD', 'CA$',    2),
  ('MXN', 'MX$',    2),
  ('BRL', 'R$',     2),
  ('ARS', 'AR$',    2),
  ('COP', 'COL$',   2),
  ('CLP', 'CLP$',   0),
  ('PEN', 'S/',     2),
  -- Oceania
  ('AUD', 'A$',     2),
  ('NZD', 'NZ$',    2)
on conflict (code) do update
  set symbol = excluded.symbol, decimals = excluded.decimals;

-- ---------------------------------------------------------------------------
-- Phase 1 locales (contract): en, es, fr, pt, ar, zh, hi, sw, de, id
-- ---------------------------------------------------------------------------
insert into locales (code, name, dir, is_active) values
  ('en', 'English',          'ltr', true),
  ('es', 'Español',          'ltr', true),
  ('fr', 'Français',         'ltr', true),
  ('pt', 'Português',        'ltr', true),
  ('ar', 'العربية',          'rtl', true),
  ('zh', '中文',             'ltr', true),
  ('hi', 'हिन्दी',            'ltr', true),
  ('sw', 'Kiswahili',        'ltr', true),
  ('de', 'Deutsch',          'ltr', true),
  ('id', 'Bahasa Indonesia', 'ltr', true)
on conflict (code) do update
  set name = excluded.name, dir = excluded.dir, is_active = excluded.is_active;

-- ---------------------------------------------------------------------------
-- Countries (ISO 3166-1 alpha-2, name, currency, default Phase 1 locale)
-- default_locale is limited to the 10 Phase 1 locales; English is used where
-- the main local language is not yet supported.
-- ---------------------------------------------------------------------------
insert into countries (code, name, currency, default_locale, is_active) values
  -- Africa
  ('KE', 'Kenya',                'KES', 'sw', true),
  ('TZ', 'Tanzania',             'TZS', 'sw', true),
  ('UG', 'Uganda',               'UGX', 'en', true),
  ('RW', 'Rwanda',               'RWF', 'en', true),
  ('ET', 'Ethiopia',             'ETB', 'en', true),
  ('NG', 'Nigeria',              'NGN', 'en', true),
  ('GH', 'Ghana',                'GHS', 'en', true),
  ('ZA', 'South Africa',         'ZAR', 'en', true),
  ('ZM', 'Zambia',               'ZMW', 'en', true),
  ('EG', 'Egypt',                'EGP', 'ar', true),
  ('MA', 'Morocco',              'MAD', 'ar', true),
  ('DZ', 'Algeria',              'DZD', 'ar', true),
  ('TN', 'Tunisia',              'TND', 'ar', true),
  ('SN', 'Senegal',              'XOF', 'fr', true),
  ('CI', 'Côte d''Ivoire',       'XOF', 'fr', true),
  ('CM', 'Cameroon',             'XAF', 'fr', true),
  ('MZ', 'Mozambique',           'MZN', 'pt', true),
  ('AO', 'Angola',               'AOA', 'pt', true),
  -- Middle East
  ('AE', 'United Arab Emirates', 'AED', 'ar', true),
  ('SA', 'Saudi Arabia',         'SAR', 'ar', true),
  ('QA', 'Qatar',                'QAR', 'ar', true),
  ('KW', 'Kuwait',               'KWD', 'ar', true),
  ('BH', 'Bahrain',              'BHD', 'ar', true),
  ('OM', 'Oman',                 'OMR', 'ar', true),
  ('JO', 'Jordan',               'JOD', 'ar', true),
  ('IQ', 'Iraq',                 'IQD', 'ar', true),
  ('TR', 'Türkiye',              'TRY', 'en', true),
  -- Asia
  ('IN', 'India',                'INR', 'hi', true),
  ('PK', 'Pakistan',             'PKR', 'en', true),
  ('BD', 'Bangladesh',           'BDT', 'en', true),
  ('LK', 'Sri Lanka',            'LKR', 'en', true),
  ('NP', 'Nepal',                'NPR', 'hi', true),
  ('CN', 'China',                'CNY', 'zh', true),
  ('HK', 'Hong Kong',            'HKD', 'zh', true),
  ('TW', 'Taiwan',               'TWD', 'zh', true),
  ('SG', 'Singapore',            'SGD', 'en', true),
  ('MY', 'Malaysia',             'MYR', 'en', true),
  ('ID', 'Indonesia',            'IDR', 'id', true),
  ('PH', 'Philippines',          'PHP', 'en', true),
  ('TH', 'Thailand',             'THB', 'en', true),
  ('VN', 'Vietnam',              'VND', 'en', true),
  ('JP', 'Japan',                'JPY', 'en', true),
  ('KR', 'South Korea',          'KRW', 'en', true),
  -- Europe
  ('GB', 'United Kingdom',       'GBP', 'en', true),
  ('IE', 'Ireland',              'EUR', 'en', true),
  ('DE', 'Germany',              'EUR', 'de', true),
  ('AT', 'Austria',              'EUR', 'de', true),
  ('CH', 'Switzerland',          'CHF', 'de', true),
  ('FR', 'France',               'EUR', 'fr', true),
  ('BE', 'Belgium',              'EUR', 'fr', true),
  ('NL', 'Netherlands',          'EUR', 'en', true),
  ('ES', 'Spain',                'EUR', 'es', true),
  ('PT', 'Portugal',             'EUR', 'pt', true),
  ('IT', 'Italy',                'EUR', 'en', true),
  ('PL', 'Poland',               'PLN', 'en', true),
  ('SE', 'Sweden',               'SEK', 'en', true),
  ('NO', 'Norway',               'NOK', 'en', true),
  ('DK', 'Denmark',              'DKK', 'en', true),
  -- Americas
  ('US', 'United States',        'USD', 'en', true),
  ('CA', 'Canada',               'CAD', 'en', true),
  ('MX', 'Mexico',               'MXN', 'es', true),
  ('BR', 'Brazil',               'BRL', 'pt', true),
  ('AR', 'Argentina',            'ARS', 'es', true),
  ('CO', 'Colombia',             'COP', 'es', true),
  ('CL', 'Chile',                'CLP', 'es', true),
  ('PE', 'Peru',                 'PEN', 'es', true),
  -- Oceania
  ('AU', 'Australia',            'AUD', 'en', true),
  ('NZ', 'New Zealand',          'NZD', 'en', true)
on conflict (code) do update
  set name = excluded.name, currency = excluded.currency, default_locale = excluded.default_locale;

-- ---------------------------------------------------------------------------
-- fx_rates: SAMPLE VALUES ONLY. NOT LIVE. DO NOT PRICE REAL ORDERS WITH THESE.
--
-- Rough, rounded USD->quote figures so local development shows plausible
-- prices. fetched_at is pinned to 2000-01-01 on purpose so any staleness
-- check treats them as expired. The FX job (FX_API_URL) overwrites them.
-- `on conflict do nothing` keeps real rates if they are already loaded.
-- ---------------------------------------------------------------------------
insert into fx_rates (base, quote, rate, fetched_at)
select 'USD', v.quote, v.rate, timestamptz '2000-01-01 00:00:00+00'
from (values
  ('USD', 1), ('EUR', 0.92), ('GBP', 0.79), ('CHF', 0.87), ('PLN', 4.0),
  ('SEK', 10.6), ('NOK', 10.9), ('DKK', 6.85), ('TRY', 34),
  ('KES', 129), ('TZS', 2700), ('UGX', 3700), ('RWF', 1400), ('ETB', 120),
  ('NGN', 1550), ('GHS', 15), ('ZAR', 18.2), ('EGP', 49), ('MAD', 9.9),
  ('DZD', 134), ('TND', 3.1), ('XOF', 605), ('XAF', 605), ('ZMW', 27),
  ('MZN', 63.9), ('AOA', 910),
  ('AED', 3.6725), ('SAR', 3.75), ('QAR', 3.64), ('KWD', 0.307), ('BHD', 0.376),
  ('OMR', 0.3845), ('JOD', 0.709), ('IQD', 1310),
  ('INR', 84), ('PKR', 278), ('BDT', 120), ('LKR', 295), ('NPR', 134),
  ('CNY', 7.2), ('HKD', 7.78), ('TWD', 32), ('SGD', 1.33), ('MYR', 4.4),
  ('IDR', 15800), ('PHP', 57), ('THB', 34.5), ('VND', 25000), ('JPY', 150),
  ('KRW', 1380),
  ('CAD', 1.38), ('MXN', 19.5), ('BRL', 5.6), ('ARS', 1000), ('COP', 4200),
  ('CLP', 940), ('PEN', 3.75),
  ('AUD', 1.5), ('NZD', 1.65)
) as v(quote, rate)
on conflict (base, quote) do nothing;
