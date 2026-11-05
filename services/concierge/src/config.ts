import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env from the service folder or the repo root (Node >= 21 built-in, no dotenv needed).
const here = dirname(fileURLToPath(import.meta.url));
for (const p of [resolve(here, '../.env'), resolve(here, '../../../.env')]) {
  if (existsSync(p) && !process.env.VITEST) {
    try { process.loadEnvFile(p); } catch { /* ignore malformed env file */ }
  }
}

const env = (k: string, d = ''): string => (process.env[k] ?? d).trim();

export interface Config {
  port: number;
  publicUrl: string;
  /** Shared secret for /internal/* routes (loopback-only when empty). */
  internalToken: string;
  webBaseUrl: string;
  databaseUrl: string;
  searchApiUrl: string;
  catalogApiUrl: string;
  /** Bearer token for CATALOG_API_URL POST /orders/{id}/forward. */
  catalogApiToken: string;
  /** Skip all HTTP calls to search/catalog and use fixtures (tests). */
  offline: boolean;
  /** Use fixtures when search/catalog are unreachable. Never in production. */
  fixtureFallback: boolean;
  whatsapp: { phoneNumberId: string; accessToken: string; verifyToken: string; appSecret: string; graphVersion: string };
  anthropic: { apiKey: string; model: string };
  stripe: { secretKey: string; webhookSecret: string };
  paystack: { secretKey: string };
  flutterwave: { secretKey: string; webhookHash: string };
  paypal: { clientId: string; clientSecret: string; webhookId: string; sandbox: boolean };
  mpesa: { consumerKey: string; consumerSecret: string; shortcode: string; passkey: string; callbackToken: string; sandbox: boolean };
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const port = Number(env('CONCIERGE_PORT', '4030')) || 4030;
  const production = env('NODE_ENV') === 'production';
  const base: Config = {
    port,
    publicUrl: env('CONCIERGE_PUBLIC_URL', `http://localhost:${port}`).replace(/\/$/, ''),
    internalToken: env('CONCIERGE_INTERNAL_TOKEN'),
    webBaseUrl: env('WEB_BASE_URL', 'http://localhost:3000').replace(/\/$/, ''),
    databaseUrl: env('DATABASE_URL'),
    searchApiUrl: env('SEARCH_API_URL', 'http://localhost:4010').replace(/\/$/, ''),
    catalogApiToken: env('CATALOG_API_TOKEN'),
    catalogApiUrl: env('CATALOG_API_URL', 'http://localhost:4020').replace(/\/$/, ''),
    offline: env('CONCIERGE_OFFLINE') === '1',
    fixtureFallback: !production && env('CONCIERGE_FIXTURE_FALLBACK', '1') !== '0',
    whatsapp: {
      phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID'),
      accessToken: env('WHATSAPP_ACCESS_TOKEN'),
      verifyToken: env('WHATSAPP_VERIFY_TOKEN'),
      appSecret: env('WHATSAPP_APP_SECRET'),
      graphVersion: env('WHATSAPP_GRAPH_VERSION', 'v23.0'),
    },
    anthropic: { apiKey: env('ANTHROPIC_API_KEY'), model: env('ANTHROPIC_MODEL', 'claude-sonnet-5-5') },
    stripe: { secretKey: env('STRIPE_SECRET_KEY'), webhookSecret: env('STRIPE_WEBHOOK_SECRET') },
    paystack: { secretKey: env('PAYSTACK_SECRET_KEY') },
    flutterwave: { secretKey: env('FLUTTERWAVE_SECRET_KEY'), webhookHash: env('FLUTTERWAVE_WEBHOOK_HASH') },
    paypal: {
      clientId: env('PAYPAL_CLIENT_ID'),
      clientSecret: env('PAYPAL_CLIENT_SECRET'),
      webhookId: env('PAYPAL_WEBHOOK_ID'),
      sandbox: env('PAYPAL_ENV', 'sandbox') !== 'live',
    },
    mpesa: {
      consumerKey: env('MPESA_CONSUMER_KEY'),
      consumerSecret: env('MPESA_CONSUMER_SECRET'),
      shortcode: env('MPESA_SHORTCODE'),
      passkey: env('MPESA_PASSKEY'),
      callbackToken: env('MPESA_CALLBACK_TOKEN'),
      sandbox: env('MPESA_ENV', 'sandbox') !== 'live',
    },
  };
  return { ...base, ...overrides };
}

/** Config with every external integration forced into mock mode (simulator, tests). */
export function mockConfig(overrides: Partial<Config> = {}): Config {
  const c = loadConfig();
  return {
    ...c,
    databaseUrl: '',
    whatsapp: { ...c.whatsapp, phoneNumberId: '', accessToken: '' },
    anthropic: { ...c.anthropic, apiKey: '' },
    stripe: { secretKey: '', webhookSecret: '' },
    paystack: { secretKey: '' },
    flutterwave: { secretKey: '', webhookHash: '' },
    paypal: { ...c.paypal, clientId: '', clientSecret: '' },
    mpesa: { ...c.mpesa, consumerKey: '', consumerSecret: '' },
    ...overrides,
  };
}
