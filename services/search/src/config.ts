// Reads config only from the env names in the repo's .env.example.
export interface Config {
  port: number;
  databaseUrl: string;
  catalogApiUrl: string;
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
