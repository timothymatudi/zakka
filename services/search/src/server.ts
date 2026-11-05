import { loadConfig } from './config';
import { createService } from './bootstrap';
import { buildApp } from './app';
import { LOCALES } from './types';

const cfg = loadConfig();
const { service, memory } = await createService(cfg);
const app = buildApp(
  service,
  {
    engine: () => service.engineName,
    documents: () => (service.engineName === 'memory' ? Object.fromEntries(LOCALES.map((l) => [l, memory.count(l)])) : {}),
    aiMode: cfg.anthropic.apiKey ? 'ai' : 'rules',
  },
  { logger: true },
);

await app.listen({ host: '0.0.0.0', port: cfg.port });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    app.close().finally(() => process.exit(0));
  });
}
