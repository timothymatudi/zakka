import 'server-only';

/** Server-side config. Only names from the root .env.example (plus noted additions). */
const forceMock = process.env.ZAKKA_FORCE_MOCK === '1';
const trimSlash = (v: string | undefined) => (v ?? '').replace(/\/+$/, '');

export const config = {
  searchApiUrl: forceMock ? '' : trimSlash(process.env.SEARCH_API_URL),
  catalogApiUrl: forceMock ? '' : trimSlash(process.env.CATALOG_API_URL),
  /** Bearer token for catalog POST endpoints (contract update). */
  catalogApiToken: process.env.CATALOG_API_TOKEN ?? '',
  /** Payments are owned by the concierge service (lead decision). */
  conciergeUrl: forceMock ? '' : trimSlash(process.env.CONCIERGE_PUBLIC_URL),
  conciergeToken: process.env.CONCIERGE_INTERNAL_TOKEN ?? '',
  supabaseUrl: trimSlash(process.env.SUPABASE_URL),
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? '',
  webBaseUrl: trimSlash(process.env.WEB_BASE_URL) || 'http://localhost:3000',
};

export const hasSupabase = () => Boolean(config.supabaseUrl && config.supabaseServiceKey);
