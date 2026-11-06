import { resolve } from 'node:path';
import { devCatalogPath, SERVICE_ROOT } from './sources/dev-catalog';

/**
 * Countries that get precomputed per-country fields in the index (launch
 * markets). Others still work: they're filtered by ships_to and ranked with
 * global fields, with exact values computed at query time. In DB mode the
 * active rows of `countries` replace this list (see bootstrap/indexer).
 */
export const DEFAULT_ACTIVE_COUNTRIES = [
  'KE', 'TZ', 'UG', 'RW', 'NG', 'GH', 'ZA', 'EG', 'MA',
  'AE', 'SA', 'QA', 'KW', 'OM', 'BH', 'IN', 'PK', 'ID',
  'US', 'CA', 'GB', 'DE', 'FR', 'ES', 'IT', 'NL', 'BR', 'MX', 'AU',
];

// Reads config from the env names in the repo's .env.example (plus the search-specific ones documented in the README).
export interface Config {
  port: number;
  databaseUrl: string;
  catalogApiUrl: string;
  /** Shared dev catalog JSON (DEV_CATALOG_PATH); relative paths resolve from services/search. */
  devCatalogPath: string;
  /** Bearer token for /admin/* (SEARCH_ADMIN_TOKEN); empty = loopback callers only. */
  adminToken: string;
  /** SEARCH_ACTIVE_COUNTRIES (comma list) or DEFAULT_ACTIVE_COUNTRIES. */
  activeCountries: string[];
  /** Local state (reference prices, offline JSONL output). */
  dataDir: string;
  /** Federated live affiliate results from the catalog (SEARCH_LIVE_AFFILIATES=0 disables). */
  liveAffiliates: { enabled: boolean; timeoutMs: number };
  typesense: { host: string; port: number; protocol: string; apiKey: string };
  anthropic: { apiKey: string; model: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  let port = 4010;
  if (env.SEARCH_API_URL) {
    try {
      const u = new URL(env.SEARCH_API_URL);
      if (u.port) port = Number(u.port);
    } catch {
      /* keep default */
    }
  }
  return {
    port,
    databaseUrl: env.DATABASE_URL ?? '',
    catalogApiUrl: env.CATALOG_API_URL || 'http://localhost:4020',
    devCatalogPath: devCatalogPath(env),
    adminToken: env.SEARCH_ADMIN_TOKEN ?? '',
    activeCountries: env.SEARCH_ACTIVE_COUNTRIES
      ? [...new Set(env.SEARCH_ACTIVE_COUNTRIES.split(',').map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))]
      : DEFAULT_ACTIVE_COUNTRIES,
    dataDir: resolve(SERVICE_ROOT, 'data'),
    liveAffiliates: { enabled: env.SEARCH_LIVE_AFFILIATES !== '0', timeoutMs: 800 },
    typesense: {
      host: env.TYPESENSE_HOST || 'localhost',
      port: Number(env.TYPESENSE_PORT || 8108),
      protocol: env.TYPESENSE_PROTOCOL || 'http',
      apiKey: env.TYPESENSE_API_KEY ?? '',
    },
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY ?? '',
      // Query parsing is a small extraction task; a fast model is enough when ANTHROPIC_MODEL is unset.
      model: env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
    },
  };
}
