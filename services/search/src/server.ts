import { loadConfig } from './config';
import { createService } from './bootstrap';
import { buildApp } from './app';

const cfg = loadConfig();
const { service, memory, reindexer, dataset, active } = await createService(cfg);
const app = buildApp(
  service,
  {
    engine: () => service.engineName,
    documents: () => (service.engineName === 'memory' ? memory.count() : null),
    aiMode: cfg.anthropic.apiKey ? 'ai' : 'rules',
    dataset: () => dataset().name,
    activeCountries: () => active.size,
  },
  { logger: true, reindexer, adminToken: cfg.adminToken },
);

await app.listen({ host: '0.0.0.0', port: cfg.port });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    app.close().finally(() => process.exit(0));
  });
}
