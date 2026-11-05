import 'server-only';

/** Server-side config. Only names from the root .env.example (plus noted additions). */
const forceMock = process.env.ZAKKA_FORCE_MOCK === '1';

export const config = {
  searchApiUrl: forceMock ? '' : (process.env.SEARCH_API_URL ?? '').replace(/\/$/, ''),
  catalogApiUrl: forceMock ? '' : (process.env.CATALOG_API_URL ?? '').replace(/\/$/, ''),
  /** Bearer token for catalog POST endpoints (contract update). */
  catalogApiToken: process.env.CATALOG_API_TOKEN ?? '',
  supabaseUrl: (process.env.SUPABASE_URL ?? '').replace(/\/$/, ''),
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  webBaseUrl: process.env.WEB_BASE_URL ?? 'http://localhost:3000',
  payments: {
    stripe: process.env.STRIPE_SECRET_KEY ?? '',
    paypal: process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET ? 'set' : '',
    flutterwave: process.env.FLUTTERWAVE_SECRET_KEY ?? '',
    paystack: process.env.PAYSTACK_SECRET_KEY ?? '',
    mpesa: process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET ? 'set' : '',
  },
};

export const hasSupabase = () => Boolean(config.supabaseUrl && config.supabaseServiceKey);
